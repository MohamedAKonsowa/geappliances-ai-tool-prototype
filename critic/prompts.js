/**
 * Critic Prompt Templates
 * Used by planCritic and codeCritic to evaluate outputs
 */

const PLAN_CRITIC_PROMPT = (userPrompt, planJSON) => `You are a strict QA reviewer for a front-end product plan.

=== CRITICAL: OUTPUT FORMAT ===
Output ONLY valid JSON. No markdown, no code fences, no explanations.
Start with { and end with }. Nothing else.

=== SEVERITY RUBRIC ===
- HIGH: Security violations (fetch, iframes), missing core requirements, logically impossible flows.
- MEDIUM: Sub-optimal component choice, missing secondary features, slight deviation from GE branding.
- LOW: Minor stylistic nitpicks, overly verbose plan, redundant state.

=== YOUR TASK ===
Review the plan below and determine if it adequately addresses the user's request.
Check for:
1. COMPLETENESS - Does it cover all user requirements?
2. FEASIBILITY - Can it be built with HTML/CSS/JS and available libraries?
3. SECURITY - Does it avoid forbidden patterns (fetch, iframes, external APIs)?
4. STRUCTURE - Are pages, components, state, and interactions well-defined?
5. CLARITY - Is the plan specific enough for a coder to implement?

IMPORTANT: window.geaRuntimeLLM() is ALLOWED - this is the built-in AI helper, not an external API.
IMPORTANT: window.geaRuntimeStore is ALLOWED - this is the built-in persistent storage.

=== RESPONSE SCHEMA ===
{
  "approved": boolean,
  "issues": [
    {
      "severity": "low" | "med" | "high",
      "area": "completeness" | "feasibility" | "security" | "structure" | "clarity",
      "message": "specific issue description"
    }
  ],
  "suggestedPatchPrompt": "optional: if not approved, a one-line instruction for the planner to fix issues"
}

=== APPROVAL GUIDELINES ===
- Set "approved": true if the plan is functional, secure, and addresses the CORE requirements, even if it has Low or some Medium issues.
- Set "approved": false ONLY for High severity issues (Security/Missing Core Features) or if the accumulation of Medium issues makes the plan unusable.
- We want progress, not perfection. If it's "good enough" to build, approve it.

=== USER PROMPT ===
${userPrompt}

=== PLAN TO REVIEW ===
${JSON.stringify(planJSON, null, 2)}

Now output ONLY the JSON review:`;


const CODE_CRITIC_PROMPT = (userPrompt, planJSON, html) => `You are a strict QA code reviewer checking if the generated HTML implements the plan correctly.

=== CRITICAL: OUTPUT FORMAT ===
Output ONLY valid JSON. No markdown, no code fences, no explanations.
Start with { and end with }. Nothing else.

=== SEVERITY RUBRIC ===
- HIGH: Security violations (fetch, axios), core features from plan are missing, code is broken/non-functional, missing critical CDN scripts.
- MEDIUM: Minor missing UI elements, sub-optimal styling, missing non-critical error handling, small deviations from plan.
- LOW: Typos in text, non-perfect alignment, slightly inefficient code, missing comments.

=== YOUR TASK ===
Review the HTML and verify it implements the plan. Check for:
1. PLAN COVERAGE - All pages/components from the plan exist
2. INTERACTIONS - Required buttons, forms, event handlers work
3. STATE MANAGEMENT - State variables and logic are implemented
4. COMPLETENESS - No TODO, FIXME, or placeholder text
5. LIBRARIES - All used libraries have CDN script tags in <head>
6. ERROR HANDLING - Try/catch, loading states, user feedback

NOTE: window.geaRuntimeLLM() is the built-in AI helper - this is ALLOWED and expected.
NOTE: window.geaRuntimeStore is the built-in storage - this is ALLOWED for persistence.
NOTE: Do NOT flag helper functions like groupBy, sum, average - these should be defined inline in the script.

=== RESPONSE SCHEMA ===
{
  "approved": boolean,
  "missing": ["list of missing components/features from plan"],
  "issues": [
    {
      "severity": "low" | "med" | "high",
      "message": "specific issue description"
    }
  ],
  "fixInstructions": "if not approved, specific instructions for patching the HTML"
}

=== APPROVAL GUIDELINES ===
- Set "approved": true if the code is secure, functional, and correctly implements the CORE components of the plan.
- Accept Low or Medium issues if the app is still overall usable and fulfills the user's intent.
- Set "approved": false ONLY for High severity issues or an accumulation of Medium issues that break the product experience.
- If it works and looks decent, approve it. Perfection is not required.

=== USER PROMPT ===
${userPrompt}

=== PLAN ===
${JSON.stringify(planJSON, null, 2)}

=== HTML TO REVIEW (first 8000 chars) ===
${html.slice(0, 8000)}

Now output ONLY the JSON review:`;




const PATCH_CODE_PROMPT = (currentHtml, fixInstructions, testErrors = [], attemptHistory = []) => `
╔═══════════════════════════════════════════════════════════════════╗
║  🛑🛑🛑 STOP! READ THIS FIRST OR YOUR CODE WILL BE REJECTED 🛑🛑🛑  ║
╚════════════════════════════════════════════════════════════════════╝

YOU MUST NOT USE THESE - THEY WILL CAUSE IMMEDIATE REJECTION:

❌ fetch()           - BANNED! Your code will fail!
❌ fetch(            - BANNED! Any form of fetch is blocked!
❌ axios             - BANNED!
❌ XMLHttpRequest    - BANNED!
❌ $.ajax            - BANNED!
❌ <iframe>          - BANNED!

THE ONLY ALLOWED NETWORK CALLS ARE:
✅ window.geaRuntimeLLM('prompt') - For AI features ONLY
✅ window.geaRuntimeStore.get/set - For persistent storage ONLY

DO NOT ADD fetch() TO LOAD LIBRARIES! Libraries are loaded via static <script> tags:
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dayjs@1/dayjs.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/papaparse@5/papaparse.min.js"></script>

DO NOT ADD fetch() TO LOAD DATA! Data comes from file inputs:
<input type="file" id="fileInput" accept=".csv">
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  Papa.parse(file, {
    header: true,
    complete: (results) => { processData(results.data); }
  });
};

HELPER FUNCTIONS - Define them INLINE in your script:
const groupBy = (arr, key) => arr.reduce((acc, obj) => { (acc[obj[key]] = acc[obj[key]] || []).push(obj); return acc; }, {});
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

═══════════════════════════════════════════════════════════════════

=== ATTEMPT LOG (DO NOT REPEAT MISTAKES) ===
${attemptHistory.length > 0 ? attemptHistory.join('\n') : 'This is the first patch attempt.'}

=== ISSUES TO FIX NOW ===
${fixInstructions}

${testErrors.length > 0 ? `=== TEST ERRORS ===
${testErrors.join('\n')}` : ''}

=== YOUR TASK ===
1. FIRST, analyze the CURRENT HTML and the ATTEMPT LOG.
2. In your mind, identify the EXACT lines or logic that caused the previous failure.
3. Apply the fixes requested in 'ISSUES TO FIX NOW'.
4. Ensure you DO NOT include any forbidden APIs (fetch, axios, etc.).
5. IMPORTANT: Your output MUST be ONLY the HTML doc. Do not include your analysis in the output.

=== OUTPUT FORMAT ===
Output ONLY the complete fixed HTML document.
Start with <!DOCTYPE html> and include the ENTIRE file.
No markdown, no explanations, no code fences.
Do NOT start with "Here is the fixed code" or "I have identified the issue".
Just the HTML.

=== CURRENT HTML ===
${currentHtml}

Now output the FIXED HTML starting with <!DOCTYPE html>:`;


module.exports = {
  PLAN_CRITIC_PROMPT,
  CODE_CRITIC_PROMPT,
  PATCH_CODE_PROMPT
};
