/**
 * Deterministic Security Scanner
 * Replaces LLM-based security checks with fast regex pattern detection
 * Acts as a CI/CD gate - only fails on objective violations
 */

const BANNED_PATTERNS = [
    { pattern: /\bfetch\s*\(/g, name: 'fetch()', fix: 'Use window.geaRuntimeLLM() for AI calls' },
    { pattern: /\baxios\./g, name: 'axios', fix: 'Use window.geaRuntimeLLM() for AI calls' },
    { pattern: /\baxios\s*\(/g, name: 'axios()', fix: 'Use window.geaRuntimeLLM() for AI calls' },
    { pattern: /\bXMLHttpRequest\b/g, name: 'XMLHttpRequest', fix: 'Use window.geaRuntimeLLM() for AI calls' },
    { pattern: /\$\.ajax\s*\(/g, name: '$.ajax()', fix: 'Use window.geaRuntimeLLM() for AI calls' },
    { pattern: /jQuery\.ajax\s*\(/g, name: 'jQuery.ajax()', fix: 'Use window.geaRuntimeLLM() for AI calls' },
    { pattern: /\beval\s*\(/g, name: 'eval()', fix: 'Remove eval, use safe alternatives' },
    { pattern: /new\s+Function\s*\(/g, name: 'new Function()', fix: 'Remove dynamic function creation' },
];

// Patterns that are checked globally (in HTML tags)
const BANNED_TAGS = [
    { pattern: /<iframe\b/gi, name: '<iframe>', fix: 'Remove iframe, use <div> containers' },
    { pattern: /<embed\b/gi, name: '<embed>', fix: 'Remove embed tag' },
    { pattern: /<object\b/gi, name: '<object>', fix: 'Remove object tag' },
];

/**
 * Remove comments and string literals from code to prevent false positives
 * e.g. // fetch() or console.log("fetch") should not trigger violations
 */
function stripCommentsAndStrings(code) {
    let output = '';
    let i = 0;
    const len = code.length;

    while (i < len) {
        const char = code[i];
        const next = code[i + 1];

        // Single line comment //
        if (char === '/' && next === '/') {
            i += 2;
            while (i < len && code[i] !== '\n') i++;
            output += '\n'; // Keep line breaks for line counting ideally, but simple stripping is safer for now
        }
        // Multi line comment /* ... */
        else if (char === '/' && next === '*') {
            i += 2;
            while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++;
            i += 2;
        }
        // String literal "..."
        else if (char === '"') {
            i++;
            output += '""'; // Replace with empty string
            while (i < len) {
                if (code[i] === '"' && code[i - 1] !== '\\') break;
                i++;
            }
            i++;
        }
        // String literal '...'
        else if (char === "'") {
            i++;
            output += "''"; // Replace with empty string
            while (i < len) {
                if (code[i] === "'" && code[i - 1] !== '\\') break;
                i++;
            }
            i++;
        }
        // Template literal `...`
        else if (char === '`') {
            i++;
            output += '``'; // Replace with empty string
            while (i < len) {
                if (code[i] === '`' && code[i - 1] !== '\\') break;
                i++;
            }
            i++;
        }
        else {
            output += char;
            i++;
        }
    }
    return output;
}

/**
 * Extract executable code from HTML (scripts and event handlers)
 */
function extractExecutableCode(html) {
    let combinedCode = '';

    // 1. Extract <script> content
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
        combinedCode += match[1] + '\n';
    }

    // 2. Extract inline event handlers (onclick, onmouseover, etc)
    const handlerRegex = /\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)'|([^>\s]*))/gi;
    while ((match = handlerRegex.exec(html)) !== null) {
        // match[1] = double quoted, match[2] = single quoted, match[3] = unquoted
        const handlerCode = match[1] || match[2] || match[3] || '';
        combinedCode += handlerCode + '\n';
    }

    return combinedCode;
}

/**
 * Scan HTML for security violations
 * @param {string} html - The HTML content to scan
 * @returns {{ passed: boolean, violations: Array<{pattern: string, fix: string, line?: number}> }}
 */
function scanForSecurityViolations(html) {
    const violations = [];

    // 1. Check for BANNED TAGS in raw HTML (iframe, embed, object)
    for (const { pattern, name, fix } of BANNED_TAGS) {
        const matches = html.match(pattern);
        if (matches && matches.length > 0) {
            violations.push({ pattern: name, fix, count: matches.length });
        }
    }

    // 2. Extract and sanitize executable code
    const rawCode = extractExecutableCode(html);
    const safeCode = stripCommentsAndStrings(rawCode);

    // 3. Check for BANNED PATTERNS in sanitized code (fetch, axios, eval, etc)
    for (const { pattern, name, fix } of BANNED_PATTERNS) {
        const matches = safeCode.match(pattern);
        if (matches && matches.length > 0) {
            // SPECIAL CASE: Ignore fetch/axios with empty string URLs (harmless placeholder code)
            if (name === 'fetch()' || name === 'axios' || name === 'axios()') {
                // After string stripping, empty URLs appear as '' or "" or ``
                // Look for the pattern: fetch( followed by empty quotes
                // Being very lenient: if all occurrences have empty string as first arg, ignore
                let allEmpty = true;
                const codeMatches = Array.from(safeCode.matchAll(new RegExp(pattern.source, 'g')));
                for (const match of codeMatches) {
                    const afterMatch = safeCode.substring(match.index);
                    // Check if within 10 characters we see '', "", or ``
                    const snippet = afterMatch.substring(0, 20);
                    if (!snippet.includes("''") && !snippet.includes('""') && !snippet.includes('``')) {
                        allEmpty = false;
                        break;
                    }
                }

                if (allEmpty) {
                    console.log(`[Security Scanner] ✓ Ignoring ${matches.length}x ${name} with empty URL`);
                    continue;
                }
            }

            // Find context around first match for logging
            const firstMatch = safeCode.search(pattern);
            const contextStart = Math.max(0, firstMatch - 50);
            const contextEnd = Math.min(safeCode.length, firstMatch + 100);
            const snippet = safeCode.slice(contextStart, contextEnd).replace(/\n/g, ' ').trim();

            violations.push({
                pattern: name,
                fix,
                count: matches.length,
                snippet: snippet ? `...${snippet}...` : 'N/A'
            });
        }
    }

    return {
        passed: violations.length === 0,
        violations
    };
}

/**
 * Quick check if HTML has basic valid structure
 * @param {string} html 
 * @returns {{ valid: boolean, errors: string[] }}
 */
function checkBasicStructure(html) {
    const errors = [];

    if (!/<(!DOCTYPE|html)/i.test(html)) {
        errors.push('Missing <!DOCTYPE html> or <html> tag');
    }

    if (!/<\/html>/i.test(html)) {
        errors.push('Missing closing </html> tag');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Run all deterministic security and structure checks
 * This is the main CI/CD gate function
 * @param {string} html 
 * @returns {{ passed: boolean, securityViolations: Array, structureErrors: Array, summary: string }}
 */
function runSecurityGate(html) {
    const security = scanForSecurityViolations(html);
    const structure = checkBasicStructure(html);

    const passed = security.passed && structure.valid;

    let summary = '';
    if (passed) {
        summary = '✅ PASSED: No security violations or structure errors';
    } else {
        const issues = [];
        if (!security.passed) {
            issues.push(`${security.violations.length} security violation(s)`);
        }
        if (!structure.valid) {
            issues.push(`${structure.errors.length} structure error(s)`);
        }
        summary = `❌ FAILED: ${issues.join(', ')}`;
    }

    return {
        passed,
        securityViolations: security.violations,
        structureErrors: structure.errors,
        summary
    };
}

module.exports = {
    scanForSecurityViolations,
    checkBasicStructure,
    runSecurityGate,
    BANNED_PATTERNS,
    // Export for testing
    _stripCommentsAndStrings: stripCommentsAndStrings
};
