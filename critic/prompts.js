/**
 * Critic Prompt Templates
 * Used by planCritic and codeCritic to evaluate outputs
 */

const PLAN_CRITIC_PROMPT = (userPrompt, planJSON) => `You are a SCHEMA VALIDATOR for a front-end product plan.
Your job is NOT to judge quality. Your job is to check if required fields exist and security rules are followed.

=== CRITICAL: OUTPUT FORMAT ===
Output ONLY valid JSON. No markdown, no code fences, no explanations.

=== PASS/FAIL CONTRACT ===
Check these conditions. If ANY are true, set approved: false

SECURITY VIOLATIONS (automatic FAIL):
❌ Plan mentions using fetch(), axios, or XMLHttpRequest
❌ Plan mentions using <iframe>, <embed>, or <object>
❌ Plan mentions loading external images via URL
❌ Plan mentions calling external APIs (except window.geaRuntimeLLM)

MISSING REQUIRED FIELDS (automatic FAIL):
❌ Missing 'title' field or it's empty
❌ Missing 'pages' array or it's empty
❌ Missing 'ui_components' array or it's empty

=== PASS CONDITIONS ===
If NONE of the above FAIL conditions are met → set approved: true

=== DO NOT JUDGE (always pass these) ===
✅ Whether the design is "optimal" or "could be better"
✅ Whether there are "alternative approaches"  
✅ Whether the plan is "clear enough" or "detailed enough"
✅ Whether the UI choices are "ideal"
✅ Code style, naming, or organization preferences

=== RESPONSE SCHEMA ===
{
  "approved": boolean,
  "issues": [
    {
      "severity": "high",
      "area": "security" | "schema",
      "message": "specific objective violation"
    }
  ],
  "suggestedPatchPrompt": "if not approved, one-line fix instruction"
}

=== USER PROMPT ===
${userPrompt}

=== PLAN TO VALIDATE ===
${JSON.stringify(planJSON, null, 2)}

Now output ONLY the JSON validation result:`;



const CODE_CRITIC_PROMPT = (userPrompt, planJSON, html) => `You are a DETERMINISTIC CODE VALIDATOR. Your job is binary: PASS or FAIL.
Do NOT provide opinions. Only check objective, testable facts.

=== CRITICAL: OUTPUT FORMAT ===
Output ONLY valid JSON. No markdown, no code fences, no explanations.

=== FAIL CONDITIONS (if ANY are true, set approved: false) ===

SECURITY VIOLATIONS:
❌ Code contains: fetch( or fetch(
❌ Code contains: axios. or axios(
❌ Code contains: XMLHttpRequest
❌ Code contains: $.ajax or jQuery.ajax
❌ Code contains: <iframe, <embed, or <object tags
❌ Code contains: eval( or new Function(

SYNTAX ERRORS:
❌ Missing <!DOCTYPE html> or <html> tag
❌ Missing closing </html> tag
❌ Script references undefined variables in global scope

=== PASS CONDITIONS ===
If NONE of the FAIL conditions are met → set approved: true

=== DO NOT JUDGE (always pass these) ===
✅ Code style, formatting, or naming conventions
✅ Whether there are "better" approaches
✅ Whether error handling is "sufficient"
✅ Whether the UI is "polished" or "optimal"
✅ Whether all plan features are implemented (that's what smoke tests check)
✅ Whether helper functions are defined (groupBy, sum, etc.)

IMPORTANT: window.geaRuntimeLLM() is ALLOWED
IMPORTANT: window.geaRuntimeStore is ALLOWED

=== RESPONSE SCHEMA ===
{
  "approved": boolean,
  "issues": [
    {
      "severity": "high",
      "message": "specific objective violation found"
    }
  ],
  "fixInstructions": "if not approved, one-line fix"
}

=== HTML TO VALIDATE (first 8000 chars) ===
${html.slice(0, 8000)}

Now output ONLY the JSON validation result:`;





const PATCH_CODE_PROMPT = (currentHtml, fixInstructions, testErrors = [], attemptHistory = []) => `
╔═══════════════════════════════════════════════════════════════════╗
║  🛑🛑🛑 STOP! READ THIS FIRST OR YOUR CODE WILL BE REJECTED 🛑🛑🛑  ║
╚════════════════════════════════════════════════════════════════════╝

=== ⚠️ PREVIOUS FAILED ATTEMPTS (DO NOT REPEAT THESE MISTAKES) ===
${attemptHistory.length > 0 ? attemptHistory.join('\n') : 'No previous failures.'}

=== 🛑 CRITICAL SECURITY RULES (VIOLATION = IMMEDIATE FAIL) ===
❌ fetch()           - BANNED!
❌ fetch(            - BANNED!
❌ axios             - BANNED!
❌ XMLHttpRequest    - BANNED!
❌ $.ajax            - BANNED!
❌ <iframe>          - BANNED!

=== ✅ THE ONLY ALLOWED NETWORK CALLS ===
• window.geaRuntimeLLM('prompt') - For AI features ONLY
• window.geaRuntimeStore.get/set - For persistent storage ONLY

=== 🔧 FIX INSTRUCTIONS FOR THIS ATTEMPT ===
${fixInstructions}

${testErrors.length > 0 ? `=== 🧪 TEST ERRORS ===
${testErrors.join('\n')}` : ''}

=== YOUR TASK ===
1. READ the "Previous Failed Attempts" above.
2. If you see "Forbidden: fetch", DO NOT USE FETCH again. Use geaRuntimeLLM.
3. If you see "Forbidden: iframe", DO NOT USE IFRAME again.
4. Apply the fixes requested in 'FIX INSTRUCTIONS'.
5. Output the COMPLETE corrected HTML document.

=== OUTPUT FORMAT ===
Output ONLY the complete HTML document starting with <!DOCTYPE html>.
No markdown, no explanations, no code fences.

=== CURRENT HTML ===
${currentHtml}

Now output the FIXED HTML (and nothing else):`;


module.exports = {
  PLAN_CRITIC_PROMPT,
  CODE_CRITIC_PROMPT,
  PATCH_CODE_PROMPT
};
