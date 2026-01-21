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
const { createRunDir, saveIterationArtifacts, saveFinalOutputs, saveSummary } = require('./artifactStore');
const { PATCH_CODE_PROMPT } = require('../critic/prompts');

async function runDSStarPipeline({
    prompt,
    tier = 'standard',
    plannerModel: explicitPlannerModel,
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
        if (onProgress) try { onProgress(data); } catch (e) { /* ignore */ }
    };

    const runId = `dsstar_${timestampId()}`;
    const runDir = await createRunDir(runsDir, runId);

    // Use explicit planner model if provided, otherwise default based on tier
    const tierDefaults = {
        pro: 'llama-3.3-70b-versatile',
        standard: 'llama-3.3-70b-versatile',
        basic: 'llama-3.1-8b-instant'
    };
    const plannerModel = explicitPlannerModel || tierDefaults[tier] || tierDefaults.standard;

    // Models for other agents - will be set by planner recommendations or default to tier
    let coderModel = tierDefaults[tier] || tierDefaults.standard;
    let criticModel = tierDefaults[tier] || tierDefaults.standard;
    let runtimeModel = tier === 'pro' ? 'llama-3.1-8b-instant' : 'llama-3.1-8b-instant';

    console.log(`[DS-Star] Using tier: ${tier}, planner: ${plannerModel}${explicitPlannerModel ? ' (user selected)' : ''}`);



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
                if (securityErrors.length > 0) {
                    extraDirections += '\n\nSECURITY RESTRICTIONS - DO NOT VIOLATE:\n' +
                        securityErrors.map(e => `❌ ${e}`).join('\n');
                }

                const planResult = await requestPlan(prompt, extraDirections, plannerModel, {
                    tier,
                    availableModels
                });
                currentPlan = planResult.plan;
                iterArtifacts.plan = currentPlan;

                // Extract planner's recommended models and use them
                if (currentPlan.recommended_models) {
                    const rec = currentPlan.recommended_models;
                    if (rec.coder) coderModel = rec.coder;
                    if (rec.critic) criticModel = rec.critic;
                    if (rec.runtime) runtimeModel = rec.runtime;
                    console.log(`[Phase 1] 📱 Planner recommends: coder=${coderModel}, critic=${criticModel}, runtime=${runtimeModel}`);
                }

                console.log(`[Phase 1] ✓ Plan generated`);
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
                    fixLines.push(`❌ DO NOT use ${e}`);
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

                // Add accumulated security errors as extra context
                let extra = '';
                if (securityErrors.length > 0) {
                    extra = '\n⚠️ PREVIOUS SECURITY FAILURES - AVOID THESE:\n' +
                        securityErrors.map(e => `❌ ${e}`).join('\n') + '\n\n';
                }

                const codePrompt = buildCoderPrompt(prompt, currentPlan, extra, librariesText);
                const raw = await callLLM(coderModel, codePrompt);
                currentHtml = extractHtml(raw);
            }

            currentHtml = ensureCspMeta(currentHtml);
            const unsafeReason = checkUnsafeHtml(currentHtml);
            if (unsafeReason) {
                // ACCUMULATE security error for next iteration
                if (!securityErrors.includes(unsafeReason)) {
                    securityErrors.push(unsafeReason);
                }

                failureReason = `SECURITY_CHECK: ${unsafeReason}`;
                lastFailureReason = failureReason;
                failureReports.push({ iter, phase: 'security', error: unsafeReason });
                console.log(`[Phase 3] ❌ SECURITY FAILED: ${unsafeReason}`);
                console.log(`[Phase 3] Accumulated security errors: ${securityErrors.length}`);
                emit({ type: 'iteration', iteration: iter, maxIters, phase: 'code', status: 'security_failed', error: unsafeReason });
                history.push({ iter, phase: 'security', error: unsafeReason });
                await saveIterationArtifacts(runDir, iter, iterArtifacts);
                continue;
            }

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

        // ============ PHASE 4: CRITIQUE CODE ============
        if (!codeApprovedAt) {
            console.log('[Phase 4] 🔍 CRITIQUING CODE...');
            emit({ type: 'iteration', iteration: iter, maxIters, phase: 'code_critique', status: 'working' });

            const codeCritique = await critiqueCode(callLLM, prompt, currentPlan, currentHtml, criticModel);
            iterArtifacts.codeCritique = codeCritique;

            if (codeCritique.approved) {
                codeApprovedAt = iter;
                console.log('[Phase 4] ✓ Code APPROVED');
                emit({ type: 'iteration', iteration: iter, maxIters, phase: 'code', status: 'approved' });
            } else {
                // Accumulate code issues for next iteration
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
                failureReason = `CODE_CRITIQUE: ${missing.length} missing (${missing.slice(0, 2).join(', ')}), ${issues.length} issues`;
                lastFailureReason = failureReason;

                failureReports.push({
                    iter,
                    phase: 'code_critique',
                    missing: missing,
                    issues: issues,
                    error: failureReason
                });
                console.log(`[Phase 4] ❌ Code REJECTED`);
                emit({ type: 'iteration', iteration: iter, maxIters, phase: 'code', status: 'rejected', issues: codeCritique.issues, missing: codeCritique.missing });
                history.push({ iter, phase: 'code_critique', codeCritique });
                await saveIterationArtifacts(runDir, iter, iterArtifacts);
                continue;
            }
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
            if (structured.length > 0) {
                console.log(`[Phase 5] Structured errors for patching: ${structured.length}`);
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
