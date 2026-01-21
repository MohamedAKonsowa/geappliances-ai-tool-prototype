/**
 * Plan Critic Module
 * Evaluates generated plans for completeness, feasibility, and security
 */

const { PLAN_CRITIC_PROMPT } = require('./prompts');

/**
 * Critique a generated plan
 * @param {Function} callLLM - LLM caller function
 * @param {string} userPrompt - Original user prompt
 * @param {object} planJSON - Generated plan to critique
 * @param {string} modelName - Model to use for critique
 * @returns {Promise<{approved: boolean, issues: Array, suggestedPatchPrompt?: string}>}
 */
async function critiquePlan(callLLM, userPrompt, planJSON, modelName) {
    const prompt = PLAN_CRITIC_PROMPT(userPrompt, planJSON);

    let raw;
    try {
        raw = await callLLM(modelName, prompt);
    } catch (err) {
        console.error('[PlanCritic] LLM call failed:', err.message);
        // If LLM fails, approve by default to not block pipeline
        return {
            approved: true,
            issues: [{ severity: 'low', area: 'critic', message: 'Critic unavailable, auto-approved' }],
            error: err.message
        };
    }

    // Parse response - try to extract JSON
    const result = parseJsonResponse(raw);

    if (!result) {
        console.warn('[PlanCritic] Failed to parse response, retrying with strict instruction');
        // Retry once with stricter instruction
        try {
            const retryRaw = await callLLM(modelName,
                'You MUST return valid JSON only. ' + prompt
            );
            const retryResult = parseJsonResponse(retryRaw);
            if (retryResult) return retryResult;
        } catch (err) {
            console.error('[PlanCritic] Retry failed:', err.message);
        }

        // Default to approved if we can't parse
        return {
            approved: true,
            issues: [{ severity: 'low', area: 'critic', message: 'Could not parse critic response' }],
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

    // Try direct parse
    try {
        return JSON.parse(raw.trim());
    } catch (e) { }

    // Try extracting JSON from markdown code block
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[1].trim());
        } catch (e) { }
    }

    // Try finding JSON object in response
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try {
            return JSON.parse(objMatch[0]);
        } catch (e) { }
    }

    return null;
}

module.exports = { critiquePlan };
