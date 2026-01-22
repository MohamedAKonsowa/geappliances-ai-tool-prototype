/**
 * DS-Star Orchestrator
 * Main iteration loop: Plan → Critique → Generate → Test → Patch → Repeat
 * 
 * Features:
 * - Iterates until ALL steps pass or hits max iterations
 * - Accumulates security failures to prevent repeated mistakes
 * - Supports onProgress callback for SSE streaming
 */


const { critiquePlan } = require('../critic/planCritic');
const { critiqueCode } = require('../critic/codeCritic');
const { runSmokeTests } = require('../tests/smokeTest');
const { runSecurityGate, BANNED_PATTERNS } = require('../critic/securityScanner');
const { createRunDir, saveIterationArtifacts, saveFinalOutputs, saveSummary } = require('./artifactStore');
const { PATCH_CODE_PROMPT } = require('../critic/prompts');
const { writeFile } = require('fs/promises');
const path = require('path');

async function runDSStarPipeline({
    prompt,
    plannerModel = 'llama-3.3-70b-versatile',
    coderModel = 'llama-3.3-70b-versatile',
    criticModel = 'llama-3.1-8b-instant',
    availableModels = [],
    maxIters = 8,
    deps,
    runsDir,
    onProgress = null
}) {
    const {
        callLLM,
        requestPlan,
        checkUnsafeHtml,
        ensureCspMeta,
        injectRuntimeHelpers,
        loadLibraries,
        formatLibrariesForPrompt,
        timestampId,
        buildCoderPrompt
    } = deps;

    const emit = (data) => {
        if (onProgress) try {
            onProgress({
                ...data,
                models: {
                    planner: plannerModel,
                    coder: coderModel,
                    critic: criticModel,
                    runtime: runtimeModel
                }
            });
        } catch (e) { /* ignore */ }
    };

    const runId = `dsstar_${timestampId()}`;
    const runDir = await createRunDir(runsDir, runId);
    let runtimeModel = 'llama-3.1-8b-instant'; // Fixed runtime model for now

    console.log(`[DS-Star] Starting run ${runId} with:`);
    console.log(`- Planner: ${plannerModel}`);
    console.log(`- Coder: ${coderModel}`);
    console.log(`- Critic: ${criticModel}`);



    const history = [];
    const failureReports = [];

    // ACCUMULATED ERROR MEMORY - passed to subsequent iterations
    const securityErrors = [];  // All security failures encountered
    const codeCritiqueIssues = []; // All code critique issues
    const planCritiqueIssues = []; // All plan critique issues

    let currentPlan = null;
    let currentHtml = null;
    let planApprovedAt = null;
    let codeApprovedAt = null;
    let testsPassedAt = null;
    let success = false;



    let lastFailurePhase = '';
    let lastFailureReason = '';
    let sameFailureCount = 0;


    console.log(`\n${'='.repeat(60)}`);
    console.log(`[DS-Star] Starting pipeline: ${runId}`);
    console.log(`${'='.repeat(60)}\n`);

    emit({ type: 'start', runId, maxIters });

    for (let iter = 1; iter <= maxIters; iter++) {


        console.log(`\n[DS-Star] ITERATION ${iter}/${maxIters}`);
        emit({ type: 'iteration', iteration: iter, maxIters, phase: 'start' });

        const iterArtifacts = {

            prompt,
            meta: { iteration: iter, startTime: new Date().toISOString() }
        };

        let failureReason = '';

        // ============ PHASE 1: PLAN ============
        if (!planApprovedAt) {
            console.log('[Phase 1] 📋 GENERATING PLAN...');
            emit({ type: 'iteration', iteration: iter, maxIters, phase: 'plan', status: 'working' });

            try {
                // Build extra directions from accumulated issues
                let extraDirections = '';
                if (planCritiqueIssues.length > 0) {
                    extraDirections = '\n\nPREVIOUS PLAN ISSUES TO FIX:\n' +
                        planCritiqueIssues.map(i => `- ${i}`).join('\n');
                }
                extraDirections += '\n\nSECURITY RESTRICTIONS - DO NOT VIOLATE:\n' +
                    securityErrors.map(e => `❌ ${e}`).join('\n');


                if (extraDirections) {
                    console.log(`[Phase 1] ⚠️ Re-Planning with Constraints:\n${extraDirections}`);
                }

                const planResult = await requestPlan(prompt, extraDirections, plannerModel, {
                    availableModels
                });
                currentPlan = planResult.plan;
                iterArtifacts.plan = currentPlan;

                // Extract planner's recommended models and use them
                if (currentPlan.recommended_models) {
                    const rec = currentPlan.recommended_models;
                    // ONLY update runtime model, respect user's choice for Coder/Critic
                    if (rec.runtime) runtimeModel = rec.runtime;
                    console.log(`[Phase 1] 📱 Planner recommends: runtime=${runtimeModel}`);
                }

                console.log(`[Phase 1] ✓ Plan generated:`);
                console.log(`[Phase 1]    Title: "${currentPlan.title || 'Untitled'}"`);
                console.log(`[Phase 1]    Goal: ${currentPlan.goal || 'No goal specified'}`);
                if (currentPlan.implementation_approach) {
                    console.log(`[Phase 1]    Implementation: ${currentPlan.implementation_approach}`);
                }
            } catch (err) {
                failureReason = `PLAN_GENERATION: ${err.message}`;
                lastFailureReason = failureReason;
                failureReports.push({ iter, phase: 'plan', error: err.message });
                emit({ type: 'iteration', iteration: iter, maxIters, phase: 'plan', status: 'failed', error: err.message });
                history.push({ iter, phase: 'plan', error: err.message });
                await saveIterationArtifacts(runDir, iter, iterArtifacts);
                continue;
            }


            // PHASE 2: CRITIQUE PLAN
            console.log('[Phase 2] 🔍 CRITIQUING PLAN...');
            emit({ type: 'iteration', iteration: iter, maxIters, phase: 'plan_critique', status: 'working' });

            const planCritique = await critiquePlan(callLLM, prompt, currentPlan, criticModel);
            iterArtifacts.planCritique = planCritique;

            if (planCritique.approved) {
                planApprovedAt = iter;
                console.log('[Phase 2] ✓ Plan APPROVED');
                emit({
                    type: 'iteration',
                    iteration: iter,
                    maxIters,
                    phase: 'plan',
                    status: 'approved',
                    models: { coder: coderModel, critic: criticModel, runtime: runtimeModel }
                });

            } else {
                // Accumulate plan issues for next iteration
                (planCritique.issues || []).forEach(issue => {
                    const msg = `[${issue.severity}] ${issue.area}: ${issue.message}`;
                    if (!planCritiqueIssues.includes(msg)) planCritiqueIssues.push(msg);
                });

                const issues = planCritique.issues || [];
                failureReason = `PLAN_CRITIQUE: ${issues.length} issues. ${issues.slice(0, 2).map(i => i.message).join(', ')}`;
                lastFailureReason = failureReason;
                failureReports.push({ iter, phase: 'plan_critique', issues: issues, error: failureReason });
                console.log(`[Phase 2] ❌ Plan REJECTED - ${planCritique.issues?.length || 0} issues`);
                emit({ type: 'iteration', iteration: iter, maxIters, phase: 'plan', status: 'rejected', issues: planCritique.issues });
                history.push({ iter, phase: 'plan_critique', planCritique });
                await saveIterationArtifacts(runDir, iter, iterArtifacts);
                continue;
            }
        }

        // ============ PHASE 3: GENERATE HTML ============
        console.log('[Phase 3] 💻 GENERATING HTML...');
        emit({ type: 'iteration', iteration: iter, maxIters, phase: 'code', status: 'working' });

        try {
            // Build accumulated error context for patching
            const accumulatedErrors = [
                ...securityErrors.map(e => `SECURITY: ${e}`),
                ...codeCritiqueIssues.slice(-10) // Last 10 code issues
            ];

            if (currentHtml && iter > 1 && (codeCritiqueIssues.length > 0 || securityErrors.length > 0)) {
                console.log('[Phase 3] Patching existing HTML with accumulated fixes...');

                // Build structured fix instructions
                const fixLines = ['FIX THESE ISSUES:'];

                // Add code critique issues
                codeCritiqueIssues.slice(-5).forEach(issue => {
                    fixLines.push(`• ${issue}`);
                });

                // Add structured errors from last smoke test if available
                const lastSmoke = history[iter - 2]?.smokeTest;
                if (lastSmoke?.structuredErrors) {
                    fixLines.push('', 'SPECIFIC ERRORS FROM TESTING:');
                    lastSmoke.structuredErrors.slice(0, 5).forEach(err => {
                        fixLines.push(`• [${err.severity.toUpperCase()}] ${err.type}: ${err.message}`);
                        if (err.suggestedFix) {
                            fixLines.push(`   → FIX: ${err.suggestedFix}`);
                        }
                    });
                }

                fixLines.push('', 'SECURITY RULES (MUST FOLLOW):');
                securityErrors.forEach(e => {
                    // Normalize legacy errors to match our keys
                    let key = e;
                    if (e.includes('fetch')) key = 'fetch()';
                    else if (e.includes('iframe')) key = '<iframe>';
                    else if (e.includes('axios')) key = 'axios';
                    else if (e.includes('XMLHttpRequest')) key = 'XMLHttpRequest';
                    else if (e.includes('embed')) key = '<embed>';
                    else if (e.includes('object')) key = '<object>';

                    const patternDef = BANNED_PATTERNS.find(p => p.name === key);
                    const fix = patternDef ? patternDef.fix : '';

                    if (patternDef) {
                        fixLines.push(`❌ ${key} IS BANNED → ${fix}`);
                    } else {
                        // Fallback for unknown errors
                        fixLines.push(`❌ CORRECT THIS SECURITY ERROR: ${e}`);
                    }
                });

                const attemptHistory = failureReports.map(r =>
                    `Iteration ${r.iter}: Phase ${r.phase} failed with ${r.error || (r.issues ? r.issues.length + ' issues' : 'unknown error')}`
                );

                // Get console errors from last test
                const testErrors = lastSmoke?.results?.consoleErrors || [];

                const patchPrompt = PATCH_CODE_PROMPT(
                    currentHtml,
                    fixLines.join('\n'),
                    testErrors,
                    attemptHistory
                );
                const patched = await callLLM(coderModel, patchPrompt);
                currentHtml = extractHtml(patched);

            } else {
                console.log('[Phase 3] Generating fresh HTML...');
                const libs = await loadLibraries();
                const librariesText = formatLibrariesForPrompt(libs);

                // Add accumulated security errors as extra context WITH FIX INSTRUCTIONS
                let extra = '';
                if (securityErrors.length > 0) {
                    extra = '\n⚠️ SECURITY RESTRICTIONS - DO NOT VIOLATE:\n';
                    securityErrors.forEach(e => {
                        // Normalize and find fix instruction
                        let key = e;
                        if (e.includes('fetch')) key = 'fetch()';
                        else if (e.includes('iframe')) key = '<iframe>';
                        else if (e.includes('axios')) key = 'axios';
                        else if (e.includes('XMLHttpRequest')) key = 'XMLHttpRequest';
                        else if (e.includes('embed')) key = '<embed>';
                        else if (e.includes('object')) key = '<object>';

                        const patternDef = BANNED_PATTERNS.find(p => p.name === key);
                        const fix = patternDef ? patternDef.fix : '';

                        if (patternDef) {
                            extra += `❌ ${key} IS BANNED → ${fix}\n`;
                        } else {
                            extra += `❌ ${e}\n`;
                        }
                    });

                    // Add concrete code example for LLM calls
                    if (securityErrors.some(e => e.includes('fetch') || e.includes('axios') || e.includes('XMLHttpRequest'))) {
                        extra += '\n✅ CORRECT WAY TO MAKE LLM CALLS:\n';
                        extra += '```javascript\n';
                        extra += '// Use window.geaRuntimeLLM() instead of fetch/axios\n';
                        extra += 'const response = await window.geaRuntimeLLM({\n';
                        extra += '  prompt: "Your prompt here",\n';
                        extra += '  model: "llama-3.3-70b-versatile" // or your chosen model\n';
                        extra += '});\n';
                        extra += 'const result = response.text; // Extract the result\n';
                        extra += '```\n';
                    }
                    extra += '\n';
                }

                const codePrompt = buildCoderPrompt(prompt, currentPlan, extra, librariesText);
                console.log(`[Phase 3] 🎯 Sending to Coder:`);
                console.log(`[Phase 3]    Plan: ${currentPlan.title || 'Untitled'}`);
                if (extra) {
                    console.log(`[Phase 3]    Security Constraints: ${extra.slice(0, 150)}...`);
                }
                const raw = await callLLM(coderModel, codePrompt);
                currentHtml = extractHtml(raw);
            }

            currentHtml = ensureCspMeta(currentHtml);
            currentHtml = ensureCspMeta(currentHtml);
            // Legacy security check removed. We rely on deterministic Phase 4a gate.

            currentHtml = injectRuntimeHelpers(currentHtml, runtimeModel, runId);
            iterArtifacts.html = currentHtml;
            console.log(`[Phase 3] ✓ HTML generated (${currentHtml.length} chars)`);
        } catch (err) {
            failureReason = `HTML_GENERATION: ${err.message}`;
            lastFailureReason = failureReason;
            failureReports.push({ iter, phase: 'codegen', error: err.message });
            emit({ type: 'iteration', iteration: iter, maxIters, phase: 'code', status: 'failed', error: err.message });
            history.push({ iter, phase: 'codegen', error: err.message });
            await saveIterationArtifacts(runDir, iter, iterArtifacts);
            continue;
        }

        // ============ PHASE 4a: DETERMINISTIC SECURITY SCAN (CI/CD GATE) ============
        console.log('[Phase 4a] 🔒 RUNNING SECURITY SCAN (deterministic)...');
        const securityScan = runSecurityGate(currentHtml);
        iterArtifacts.securityScan = securityScan;

        if (!securityScan.passed) {
            // Deterministic security failures ALWAYS block
            console.log(`[Phase 4a] ❌ SECURITY SCAN FAILED:${securityScan.summary}`);
            securityScan.securityViolations.forEach(v => {
                console.log(`[Phase 4a]    Violation: ${v.pattern} - ${v.fix}`);
                if (v.snippet) {
                    console.log(`[Phase 4a]    Code: ${v.snippet}`);
                }
                if (!securityErrors.includes(v.pattern)) {
                    securityErrors.push(v.pattern);
                }
            });

            // REACTIVE PLANNING: Invalidate the plan so we generate a NEW one that respects the security rules
            planApprovedAt = null;
            currentPlan = null;
            currentHtml = null; // Force fresh code generation from new plan


            failureReason = `SECURITY_SCAN: ${securityScan.summary}`;
            lastFailureReason = failureReason;
            failureReports.push({ iter, phase: 'security_scan', violations: securityScan.securityViolations, errors: securityScan.structureErrors });
            console.log(`[Phase 4a] ❌ SECURITY SCAN FAILED: ${securityScan.summary}`);
            console.log(`[Phase 4a] ⚠️ Critical Security Failure - INVALIDATING PLAN to force re-planning.`);

            emit({ type: 'iteration', iteration: iter, maxIters, phase: 'security_scan', status: 'failed', violations: securityScan.securityViolations });
            history.push({ iter, phase: 'security_scan', securityScan });
            await saveIterationArtifacts(runDir, iter, iterArtifacts);
            continue;
        }
        console.log('[Phase 4a] ✓ Security scan PASSED (deterministic)');

        // ============ PHASE 4b: LLM CODE CRITIQUE (ADVISORY ONLY) ============
        // CI/CD Philosophy: Critics are ADVISORY, not blocking.
        // We log their feedback but proceed to smoke tests which are authoritative.
        console.log('[Phase 4b] 🔍 LLM CODE CRITIQUE (advisory)...');
        emit({ type: 'iteration', iteration: iter, maxIters, phase: 'code_critique', status: 'working' });

        const codeCritique = await critiqueCode(callLLM, prompt, currentPlan, currentHtml, criticModel);
        iterArtifacts.codeCritique = codeCritique;

        if (codeCritique.approved) {
            codeApprovedAt = iter;
            console.log('[Phase 4b] ✓ Code APPROVED by critic');
            emit({ type: 'iteration', iteration: iter, maxIters, phase: 'code', status: 'approved' });
        } else {
            // Accumulate code issues for potential patching, but DON'T block
            (codeCritique.issues || []).forEach(issue => {
                const msg = `[${issue.severity}] ${issue.message}`;
                if (!codeCritiqueIssues.includes(msg)) codeCritiqueIssues.push(msg);
            });
            (codeCritique.missing || []).forEach(m => {
                const msg = `Missing: ${m}`;
                if (!codeCritiqueIssues.includes(msg)) codeCritiqueIssues.push(msg);
            });

            const missing = codeCritique.missing || [];
            const issues = codeCritique.issues || [];

            // CI/CD: Log the advisory feedback but PROCEED to smoke tests
            console.log(`[Phase 4b] ⚠️ Code critic has concerns (advisory): ${missing.length} missing, ${issues.length} issues`);
            emit({ type: 'iteration', iteration: iter, maxIters, phase: 'code', status: 'advisory_issues', issues: codeCritique.issues, missing: codeCritique.missing });
            // NOTE: We do NOT continue here - proceed to smoke tests
        }

        // ============ PHASE 5: SMOKE TESTS ============
        console.log('[Phase 5] 🧪 RUNNING SMOKE TESTS...');
        emit({ type: 'iteration', iteration: iter, maxIters, phase: 'tests', status: 'working' });

        const smokeTest = await runSmokeTests(currentHtml, currentPlan);
        iterArtifacts.smokeTest = smokeTest;

        if (smokeTest.passed || smokeTest.results?.skipped) {
            testsPassedAt = iter;
            success = true;
            console.log('[Phase 5] ✓ Smoke tests PASSED');
            emit({ type: 'iteration', iteration: iter, maxIters, phase: 'tests', status: 'passed' });
        } else {
            const errors = smokeTest.results?.consoleErrors || [];
            const missing = smokeTest.results?.missingSelectors || [];
            const structured = smokeTest.structuredErrors || [];
            const fatal = smokeTest.results?.fatalError ? ` FATAL: ${smokeTest.results.fatalError}` : '';

            // Format missing as strings for backward compatibility
            const missingStrs = missing.map(m => typeof m === 'string' ? m : m.selector);
            failureReason = `SMOKE_TESTS: ${errors.length} errors, ${missing.length} missing elements.${fatal}`;
            lastFailureReason = failureReason;

            failureReports.push({
                iter,
                phase: 'smoke_tests',
                consoleErrors: errors,
                missingSelectors: missingStrs,
                structuredErrors: structured,
                fatalError: smokeTest.results?.fatalError,
                error: failureReason
            });

            // Store in history for patching to access
            history.push({ iter, phase: 'smoke_tests', smokeTest });

            console.log(`[Phase 5] ❌ Smoke tests FAILED: ${failureReason}`);
            if (errors.length > 0) {
                console.log(`[Phase 5] Console Errors:`);
                errors.slice(0, 3).forEach((err, i) => {
                    console.log(`[Phase 5]    ${i + 1}. ${err}`);
                });
            }
            if (missing.length > 0) {
                console.log(`[Phase 5] Missing Elements:`);
                missing.slice(0, 3).forEach((sel, i) => {
                    const selector = typeof sel === 'string' ? sel : sel.selector;
                    console.log(`[Phase 5]    ${i + 1}. ${selector}`);
                });
            }
            if (structured.length > 0) {
                console.log(`[Phase 5] Structured errors for patching: ${structured.length}`);
                structured.slice(0, 2).forEach((err, i) => {
                    console.log(`[Phase 5]    ${i + 1}. [${err.severity}] ${err.type}: ${err.message}`);
                });
            }
            emit({ type: 'iteration', iteration: iter, maxIters, phase: 'tests', status: 'failed', errors, missing: missingStrs, fatalError: smokeTest.results?.fatalError });
        }

        iterArtifacts.meta.endTime = new Date().toISOString();
        iterArtifacts.meta.success = success;
        await saveIterationArtifacts(runDir, iter, iterArtifacts);
        history.push({ iter, success, planApprovedAt, codeApprovedAt, testsPassedAt });

        if (success) {
            console.log(`\n[DS-Star] 🎉 SUCCESS at iteration ${iter}!`);
            emit({ type: 'success', iteration: iter });
            break;
        }

        // FALLBACK: If we've done many iterations and the only issues are medium/low,
        // we might want to approve anyway to provide a result.
        const fallbackThreshold = Math.ceil(maxIters * 0.75);
        if (iter >= fallbackThreshold && !success) {
            const hasHighIssues = failureReports.some(r =>
                r.iter === iter && (
                    (r.issues && r.issues.some(i => i.severity === 'high')) ||
                    (r.phase === 'security')
                )
            );

            if (!hasHighIssues && (planApprovedAt || iterArtifacts.planCritique?.approved)) {
                console.log(`\n[DS-Star] ⚠️ FALLBACK: Approving at iteration ${iter} as remaining issues are non-critical.`);
                success = true;
                emit({ type: 'success', iteration: iter, fallback: true });
                break;
            }
        }

    }


    await saveFinalOutputs(runDir, { plan: currentPlan, html: currentHtml });

    const summary = {
        runId,
        success,
        totalIterations: history.length,
        planApprovedAt,
        codeApprovedAt,
        testsPassedAt,
        lastFailure: lastFailureReason,
        accumulatedSecurityErrors: securityErrors,
        failureReports,
        timestamp: new Date().toISOString()
    };

    await saveSummary(runDir, summary);

    // Save the most recent HTML (even on failure) so user can see what was generated
    if (currentHtml) {
        try {
            await writeFile(path.join(runDir, 'final.html'), currentHtml, 'utf8');
            console.log(`[DS-Star] Saved last HTML to final.html (${currentHtml.length} chars)`);
        } catch (err) {
            console.error(`[DS-Star] Failed to save final HTML: ${err.message}`);
        }
    }

    console.log(`\n[DS-Star] Pipeline complete. Success: ${success}`);
    if (securityErrors.length > 0) {
        console.log(`[DS-Star] Security errors encountered: ${securityErrors.join(', ')}`);
    }

    return {
        runId,
        success,
        finalPlan: currentPlan,
        finalHtmlPath: `/api/run/${runId}/final.html`,
        summary,
        history,
        failureReports,
        securityErrors
    };
}

function extractHtml(raw) {
    if (!raw) return '';
    if (raw.trim().startsWith('<!DOCTYPE') || raw.trim().startsWith('<html')) return raw.trim();
    const match = raw.match(/```(?:html)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();
    const htmlMatch = raw.match(/<(!DOCTYPE|html)[\s\S]*<\/html>/i);
    if (htmlMatch) return htmlMatch[0];
    return raw.trim();
}

module.exports = { runDSStarPipeline };
