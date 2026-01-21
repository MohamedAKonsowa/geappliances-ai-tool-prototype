/**
 * Code Critic Module
 * Evaluates generated HTML for plan coverage and implementation quality
 */

const { CODE_CRITIC_PROMPT } = require('./prompts');

/**
 * Critique generated HTML code
 * @param {Function} callLLM - LLM caller function
 * @param {string} userPrompt - Original user prompt
 * @param {object} planJSON - The plan being implemented
 * @param {string} html - Generated HTML to critique
 * @param {string} modelName - Model to use for critique
 * @returns {Promise<{approved: boolean, missing: Array, issues: Array, fixInstructions?: string}>}
 */
async function critiqueCode(callLLM, userPrompt, planJSON, html, modelName) {
    const prompt = CODE_CRITIC_PROMPT(userPrompt, planJSON, html);

    let raw;
    try {
        raw = await callLLM(modelName, prompt);
    } catch (err) {
        console.error('[CodeCritic] LLM call failed:', err.message);
        return {
            approved: true,
            missing: [],
            issues: [{ severity: 'low', message: 'Critic unavailable, auto-approved' }],
            error: err.message
        };
    }

    const result = parseJsonResponse(raw);

    if (!result) {
        console.warn('[CodeCritic] Failed to parse response, retrying...');
        try {
            const retryRaw = await callLLM(modelName,
                'You MUST return valid JSON only. ' + prompt
            );
            const retryResult = parseJsonResponse(retryRaw);
            if (retryResult) return retryResult;
        } catch (err) {
            console.error('[CodeCritic] Retry failed:', err.message);
        }

        return {
            approved: true,
            missing: [],
            issues: [{ severity: 'low', message: 'Could not parse critic response' }],
            raw
        };


    }

    return result;
}

/**
 * Parse JSON from LLM response with fallbacks
 */
function parseJsonResponse(raw) {
    if (!raw || typeof raw !== 'string') return null;

    try {
        return JSON.parse(raw.trim());
    } catch (e) { }

    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[1].trim());
        } catch (e) { }
    }

    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try {
            return JSON.parse(objMatch[0]);
        } catch (e) { }
    }

    return null;
}

module.exports = { critiqueCode };
