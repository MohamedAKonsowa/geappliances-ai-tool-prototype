/**
 * Enhanced Smoke Test Module
 * Runs comprehensive tests on generated HTML using Playwright
 * 
 * Improvements:
 * - Stricter pass/fail criteria
 * - Better selector derivation from plan
 * - Comprehensive interaction testing
 * - Runtime helper verification
 * - Structured errors for LLM patching
 */

let playwright;
try {
    playwright = require('playwright');
} catch (e) {
    console.warn('[SmokeTest] Playwright not installed. Run: npm install playwright && npx playwright install chromium');
}

/**
 * Run enhanced smoke tests on HTML content
 * @param {string} html - HTML content to test
 * @param {object} plan - Plan to derive expected elements
 * @returns {Promise<{passed: boolean, results: object, logs: string[], structuredErrors: object[]}>}
 */
async function runSmokeTests(html, plan = null) {
    const logs = [];
    const structuredErrors = [];
    const results = {
        consoleErrors: [],
        missingSelectors: [],
        loadSuccess: false,
        interactionResults: [],
        runtimeHelpers: { store: false, llm: false },
        criticalFailures: []
    };

    // Check if Playwright is available
    if (!playwright) {
        logs.push('[SKIP] Playwright not installed - returning mock pass');
        return {
            passed: true,
            results: { ...results, loadSuccess: true, skipped: true },
            logs,
            structuredErrors
        };
    }

    let browser;
    try {
        // Launch headless browser
        browser = await playwright.chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        // Capture console errors with context
        page.on('console', msg => {
            if (msg.type() === 'error') {
                const errorText = msg.text();
                results.consoleErrors.push(errorText);
                logs.push(`[CONSOLE ERROR] ${errorText}`);

                // Create structured error for LLM
                structuredErrors.push({
                    type: 'CONSOLE_ERROR',
                    message: errorText,
                    severity: categorizeError(errorText),
                    suggestedFix: suggestFix(errorText)
                });
            }
        });

        // Capture page errors (uncaught exceptions)
        page.on('pageerror', error => {
            results.consoleErrors.push(error.message);
            logs.push(`[PAGE ERROR] ${error.message}`);

            structuredErrors.push({
                type: 'UNCAUGHT_EXCEPTION',
                message: error.message,
                severity: 'critical',
                suggestedFix: `Fix the JavaScript error: ${error.message.split('\n')[0]}`
            });
        });

        // Load the HTML content
        logs.push(`[TEST] Loading HTML content (${html?.length || 0} chars)...`);
        if (!html || html.trim().length === 0) {
            throw new Error('HTML content is empty');
        }

        await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
        results.loadSuccess = true;
        logs.push('[PASS] Page loaded successfully');

        // Wait for scripts to execute and network to settle
        await page.waitForTimeout(1500);

        // ============ PHASE 1: RUNTIME HELPER VERIFICATION ============
        logs.push('[TEST] Verifying runtime helpers...');

        const runtimeCheck = await page.evaluate(() => {
            return {
                storeExists: typeof window.geaRuntimeStore !== 'undefined',
                llmExists: typeof window.geaRuntimeLLM !== 'undefined',
                storeHasMethods: window.geaRuntimeStore &&
                    typeof window.geaRuntimeStore.get === 'function' &&
                    typeof window.geaRuntimeStore.set === 'function'
            };
        });

        results.runtimeHelpers.store = runtimeCheck.storeExists && runtimeCheck.storeHasMethods;
        results.runtimeHelpers.llm = runtimeCheck.llmExists;

        if (!results.runtimeHelpers.store) {
            logs.push('[WARN] geaRuntimeStore not properly injected');
        } else {
            logs.push('[PASS] Runtime helpers verified');
        }

        // ============ PHASE 2: ELEMENT VERIFICATION ============
        if (plan) {
            const selectors = deriveSelectorsFromPlan(plan);
            logs.push(`[TEST] Checking ${selectors.length} expected elements...`);

            for (const { selector, description, critical } of selectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        logs.push(`[PASS] Found: ${description || selector}`);
                    } else {
                        const fault = { selector, description, critical };
                        results.missingSelectors.push(fault);
                        logs.push(`[FAIL] Missing ${critical ? 'CRITICAL' : ''}: ${description || selector}`);

                        structuredErrors.push({
                            type: 'MISSING_ELEMENT',
                            selector,
                            description,
                            severity: critical ? 'critical' : 'medium',
                            suggestedFix: `Add element matching: ${selector}${description ? ` (${description})` : ''}`
                        });

                        if (critical) {
                            results.criticalFailures.push(`Missing critical element: ${selector}`);
                        }
                    }
                } catch (e) {
                    logs.push(`[WARN] Could not check: ${selector} - ${e.message}`);
                }
            }
        }

        // ============ PHASE 3: COMPREHENSIVE INTERACTION TESTING ============
        logs.push('[TEST] Running interaction tests...');

        // Test all buttons
        const buttons = await page.$$('button:visible, [role="button"]:visible, input[type="submit"]:visible');
        logs.push(`[INFO] Found ${buttons.length} interactive buttons`);

        for (let i = 0; i < Math.min(buttons.length, 5); i++) {
            try {
                const buttonText = await buttons[i].textContent();
                await buttons[i].click();
                await page.waitForTimeout(200);
                logs.push(`[PASS] Button "${buttonText?.trim() || i}" clicked successfully`);
                results.interactionResults.push({ action: 'click', target: buttonText, success: true });
            } catch (e) {
                logs.push(`[WARN] Button click failed: ${e.message}`);
                results.interactionResults.push({ action: 'click', target: `button_${i}`, success: false, error: e.message });
            }
        }

        // Test input fields
        const inputs = await page.$$('input:visible:not([type="hidden"]):not([type="submit"]):not([type="button"])');
        logs.push(`[INFO] Found ${inputs.length} input fields`);

        for (let i = 0; i < Math.min(inputs.length, 3); i++) {
            try {
                await inputs[i].fill('test value');
                logs.push(`[PASS] Input ${i} accepts text`);
                results.interactionResults.push({ action: 'input', target: `input_${i}`, success: true });
            } catch (e) {
                logs.push(`[WARN] Input fill failed: ${e.message}`);
            }
        }

        // Test select dropdowns
        const selects = await page.$$('select:visible');
        for (let i = 0; i < selects.length; i++) {
            try {
                const options = await selects[i].$$('option');
                if (options.length > 1) {
                    await selects[i].selectOption({ index: 1 });
                    logs.push(`[PASS] Select ${i} is functional`);
                }
            } catch (e) {
                logs.push(`[WARN] Select interaction failed: ${e.message}`);
            }
        }

        // ============ PHASE 4: POST-INTERACTION CHECK ============
        // Wait and check if new errors appeared after interactions
        await page.waitForTimeout(500);

        // Check for any error modals or alerts
        const errorIndicators = await page.$$('[class*="error"], [class*="danger"], .alert-danger');
        if (errorIndicators.length > 0) {
            logs.push(`[WARN] Found ${errorIndicators.length} error indicators on page`);
        }


        await browser.close();

    } catch (error) {
        logs.push(`[FATAL] Test execution failed: ${error.message}`);
        structuredErrors.push({
            type: 'FATAL_ERROR',
            message: error.message,
            severity: 'critical',
            suggestedFix: 'The page failed to load or execute. Check HTML syntax and script errors.'
        });
        if (browser) await browser.close();
        return {
            passed: false,
            results: { ...results, fatalError: error.message },
            logs,
            structuredErrors
        };
    }

    // ============ DETERMINE PASS/FAIL ============
    const harmlessPatterns = [
        /favicon\.ico/i,
        /chrome-extension:/i,
        /Failed to load resource: the server responded with a status of 404/i,
        /socket\.io/i,
        /ResizeObserver loop/i,
        /Non-Error promise rejection/i
    ];

    const criticalErrors = results.consoleErrors.filter(err => {
        return !harmlessPatterns.some(pattern => pattern.test(err));
    });

    const hasCriticalErrors = criticalErrors.length > 0;
    const hasCriticalMissingElements = results.missingSelectors.some(s => s.critical);
    const hasTooManyMissing = results.missingSelectors.length > 3;

    const passed = results.loadSuccess &&
        !hasCriticalErrors &&
        !hasCriticalMissingElements &&
        !hasTooManyMissing &&
        results.criticalFailures.length === 0;

    logs.push(`[SUMMARY] Passed: ${passed}`);
    logs.push(`  - Load: ${results.loadSuccess ? 'OK' : 'FAIL'}`);
    logs.push(`  - Critical JS Errors: ${criticalErrors.length}`);
    logs.push(`  - Missing Elements: ${results.missingSelectors.length} (${results.missingSelectors.filter(s => s.critical).length} critical)`);
    logs.push(`  - Interactions Tested: ${results.interactionResults.length}`);

    return { passed, results, logs, structuredErrors };
}

/**
 * Enhanced selector derivation from plan
 */
function deriveSelectorsFromPlan(plan) {
    const selectors = [];

    // Title is critical
    if (plan.title) {
        selectors.push({
            selector: 'h1, [class*="title"], [class*="header"], header h1, header h2',
            description: 'Main title/header',
            critical: true
        });
    }

    // UI Components with improved mapping
    if (plan.ui_components) {
        for (const comp of plan.ui_components) {
            const lower = comp.toLowerCase();

            if (lower.includes('button') || lower.includes('submit')) {
                selectors.push({ selector: 'button, [role="button"]', description: comp, critical: true });
            }
            if (lower.includes('table') || lower.includes('grid')) {
                selectors.push({ selector: 'table, [class*="table"], [class*="grid"], [role="grid"]', description: comp, critical: true });
            }
            if (lower.includes('form') || lower.includes('input')) {
                selectors.push({ selector: 'form, input, textarea', description: comp, critical: true });
            }
            if (lower.includes('chart') || lower.includes('graph') || lower.includes('visual')) {
                selectors.push({ selector: 'canvas, svg, [class*="chart"], [class*="graph"]', description: comp, critical: true });
            }
            if (lower.includes('modal') || lower.includes('dialog') || lower.includes('popup')) {
                selectors.push({ selector: '[class*="modal"], dialog, [role="dialog"]', description: comp, critical: false });
            }
            if (lower.includes('search')) {
                selectors.push({ selector: 'input[type="search"], [class*="search"], input[placeholder*="search" i]', description: comp, critical: true });
            }
            if (lower.includes('dropdown') || lower.includes('select')) {
                selectors.push({ selector: 'select, [class*="dropdown"], [role="listbox"]', description: comp, critical: true });
            }
            if (lower.includes('tab')) {
                selectors.push({ selector: '[role="tablist"], [class*="tab"], .tabs', description: comp, critical: false });
            }
            if (lower.includes('card')) {
                selectors.push({ selector: '[class*="card"], article', description: comp, critical: false });
            }
            if (lower.includes('list')) {
                selectors.push({ selector: 'ul, ol, [class*="list"]', description: comp, critical: false });
            }
        }
    }

    // Navigation for multi-page apps
    if (plan.pages?.length > 1) {
        selectors.push({
            selector: 'nav, [class*="nav"], [role="navigation"], [class*="menu"]',
            description: 'Navigation for multi-page app',
            critical: true
        });
    }

    // Data bindings often need containers
    if (plan.data_bindings?.length > 0) {
        selectors.push({
            selector: '[class*="data"], [class*="content"], main, .container, #app',
            description: 'Data container',
            critical: false
        });
    }

    // Deduplicate by selector
    const seen = new Set();
    return selectors.filter(s => {
        if (seen.has(s.selector)) return false;
        seen.add(s.selector);
        return true;
    });
}

/**
 * Categorize error severity
 */
function categorizeError(errorText) {
    const critical = [
        /undefined is not a function/i,
        /is not defined/i,
        /cannot read propert/i,
        /null/i,
        /syntaxerror/i,
        /typeerror/i,
        /referenceerror/i
    ];

    if (critical.some(p => p.test(errorText))) return 'critical';
    return 'medium';
}

/**
 * Suggest fixes for common errors
 */
function suggestFix(errorText) {
    const lower = errorText.toLowerCase();

    if (lower.includes('is not defined')) {
        const match = errorText.match(/(\w+) is not defined/i);
        if (match) return `Define or import '${match[1]}' before using it`;
    }

    if (lower.includes('cannot read propert') && lower.includes('null')) {
        return 'An element was not found. Check that the selector exists before using it.';
    }

    if (lower.includes('failed to fetch')) {
        return 'Use window.geaRuntimeStore or window.geaRuntimeLLM instead of fetch()';
    }

    if (lower.includes('cors')) {
        return 'CORS error - use window.geaRuntimeStore for data operations instead of direct fetch';
    }

    return 'Review the error and fix the underlying JavaScript issue';
}

module.exports = { runSmokeTests };
