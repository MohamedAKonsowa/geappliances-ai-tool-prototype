const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const dotenv = require("dotenv");
const { jsonrepair } = require("jsonrepair");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// LLM Provider Configuration
const LLM_PROVIDER = process.env.LLM_PROVIDER || "groq"; // "groq" or "ollama"
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const OLLAMA_URL = "http://localhost:11434/api/generate";

// Model Configuration
const PLANNER_MODEL = process.env.PLANNER_MODEL || "llama-3.1-70b-versatile";
const CODER_MODEL = process.env.CODER_MODEL || "llama-3.1-70b-versatile";
const RUNTIME_MODEL = process.env.RUNTIME_MODEL || "llama-3.1-8b-instant";
const MODEL_OPTIONS = (process.env.MODEL_OPTIONS || "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const RUNS_DIR = path.join(__dirname, "runs");
const LIBRARIES_PATH = path.join(__dirname, "libraries.json");
const DASHBOARD_HTML = path.join(__dirname, "public", "index.html");
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || "0") || 120000;
const CSP_CONTENT =
  "default-src 'none'; img-src data: https: blob:; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://cdn.tailwindcss.com; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://d3js.org https://cdn.plot.ly https://cdn.tailwindcss.com blob:; worker-src blob:; connect-src 'self' http://localhost:* http://127.0.0.1:* https://*.tile.openstreetmap.org https://cdn.jsdelivr.net; base-uri 'none'; form-action 'none';";
const AVAILABLE_MODELS = Array.from(
  new Set([PLANNER_MODEL, CODER_MODEL, RUNTIME_MODEL, ...MODEL_OPTIONS])
);
const MAX_HTML_CONTEXT_CHARS = 8000;

// Load libraries from JSON file (reads fresh each time for hot-reloading)
async function loadLibraries() {
  try {
    const content = await fs.readFile(LIBRARIES_PATH, "utf8");
    return JSON.parse(content);
  } catch (err) {
    console.warn("Could not load libraries.json, using defaults:", err.message);
    return null;
  }
}

function formatLibrariesForPrompt(libs) {
  if (!libs) return "";

  let output = "";

  const formatCategory = (items, emoji, label) => {
    if (!items?.length) return "";
    let text = `${emoji} ${label}:\n`;
    items.forEach(lib => {
      const tag = lib.script || lib.link || lib.usage || "";
      text += `• ${lib.name}: ${tag}\n`;
      if (lib.example) text += `  Example: ${lib.example}\n`;
      if (lib.notes) text += `  Note: ${lib.notes}\n`;
    });
    return text + "\n";
  };

  output += formatCategory(libs.charts, "📊", "CHARTS");
  output += formatCategory(libs.tables, "📋", "TABLES");
  output += formatCategory(libs.analysis, "📈", "ANALYSIS & STATISTICS");
  output += formatCategory(libs.styling, "🎨", "STYLING");
  output += formatCategory(libs.icons, "🔣", "ICONS");
  output += formatCategory(libs.utilities, "🛠️", "UTILITIES");
  output += formatCategory(libs.ui_components, "✨", "UI COMPONENTS");
  output += formatCategory(libs.maps, "🗺️", "MAPS");
  output += formatCategory(libs.ai, "🤖", "AI FEATURES");

  // Brand colors
  if (libs.brand_colors) {
    output += "🎨 GE BRAND COLORS:\n";
    output += `• Primary: ${libs.brand_colors.primary}\n`;
    output += `• Primary Dark: ${libs.brand_colors.primary_dark}\n`;
    output += `• Accent: ${libs.brand_colors.accent}\n`;
    output += `• Success: ${libs.brand_colors.success || "#28c840"}\n`;
    output += `• Warning: ${libs.brand_colors.warning || "#ffbd2e"}\n`;
    output += `• Error: ${libs.brand_colors.error || "#ff5f57"}\n`;
    output += "\n";
  }

  return output;
}

class UnsafeHtmlError extends Error {
  constructor(message) {
    super(message);
    this.code = "UNSAFE_HTML";
  }
}

function resolveModelName(input, fallback) {
  const name = String(input || "").trim();
  return name || fallback;
}

function tryParseJson(raw) {
  const attempts = [];

  if (raw) attempts.push(raw);

  const fenceMatch = raw && raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    attempts.push(fenceMatch[1]);
  }

  if (raw) {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      attempts.push(raw.slice(firstBrace, lastBrace + 1));
    }
  }

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch (err) {
      // try repair next
    }
  }

  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      const repaired = jsonrepair(candidate);
      return JSON.parse(repaired);
    } catch (err) {
      // continue
    }
  }

  const error = new Error("Planner returned invalid JSON.");
  error.code = "INVALID_PLAN";
  error.raw = raw;
  throw error;
}

function safeParseJson(raw) {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}


app.use(express.json({ limit: "1mb" }));

function allowSandboxCors(req, res, next) {
  if (req.path !== "/api/runtime/llm") return next();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
}

app.use(allowSandboxCors);

function timestampId() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds()) +
    "_" +
    pad(d.getMilliseconds(), 3)
  );
}

// Call Groq API (OpenAI-compatible format)
async function callGroq(model, prompt) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set in environment variables");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 8192,
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = data.error?.message || `Groq API error (${res.status})`;
      throw new Error(message);
    }

    const content = data.choices?.[0]?.message?.content || "";
    return content.trim();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`LLM request timed out after ${LLM_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Call local Ollama
async function callOllama(model, prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = data.error || `Ollama error (${res.status})`;
      if (message.toLowerCase().includes("model not found")) {
        throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
      }
      throw new Error(message);
    }

    return String(data.response || "").trim();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`LLM request timed out after ${LLM_TIMEOUT_MS}ms`);
    }
    if (err.message && err.message.includes("fetch failed")) {
      throw new Error("Cannot reach Ollama. Is it running on http://localhost:11434 ?");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Unified LLM caller - uses Groq or Ollama based on LLM_PROVIDER
async function callLLM(model, prompt) {
  if (LLM_PROVIDER === "groq") {
    return callGroq(model, prompt);
  } else {
    return callOllama(model, prompt);
  }
}

// Fetch available models from Groq API
async function fetchGroqModels() {
  if (!GROQ_API_KEY) return [];

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
    });
    const data = await res.json();
    return (data.data || [])
      .filter(m => m.id && !m.id.includes("whisper"))
      .map(m => m.id)
      .sort();
  } catch (err) {
    console.warn("Failed to fetch Groq models:", err.message);
    return [];
  }
}

function buildEnhancerPrompt(userPrompt, attachedData = "") {
  const dataContext = attachedData ? `\n\nAttached data/files for context:\n${attachedData}\n` : "";

  return (
    "You are an expert product consultant helping users articulate their app ideas clearly. " +
    "Take the user's rough idea and transform it into a detailed, well-structured prompt that a planner can use to build an amazing app.\n\n" +
    "Guidelines:\n" +
    "- Keep the user's core intent but add helpful details\n" +
    "- Suggest specific UI components that would work well\n" +
    "- Add accessibility and responsive design considerations\n" +
    "- Include any data visualization needs if data is attached\n" +
    "- Keep GE Appliances branding in mind (professional, clean, functional)\n" +
    "- Be specific about interactions and user flows\n" +
    "- Output ONLY the enhanced prompt text, no explanations or markdown\n\n" +
    "User's original idea:\n" +
    userPrompt +
    dataContext +
    "\n\nEnhanced prompt:"
  );
}

function buildPlannerPrompt(userPrompt, extraDirections = "") {
  const example = {
    title: "...",
    description: "...",
    pages: [{ name: "Home", purpose: "..." }],
    ui_components: ["..."],
    libraries: ["Chart.js for charts", "Papa Parse for CSV", "..."],
    state: ["..."],
    interactions: ["..."],
    acceptance_criteria: ["..."],
  };

  const extra = extraDirections ? `\n\nAdditional guidance:\n${extraDirections}` : "";

  return (
    "You are a senior front-end product planner for GE Appliances internal tools.\n\n" +

    "=== CRITICAL: OUTPUT FORMAT ===\n" +
    "Output ONLY valid JSON. No markdown, no code fences, no explanations, no thinking.\n" +
    "Start your response with { and end with }. Nothing else.\n\n" +

    "=== AVAILABLE LIBRARIES ===\n" +
    "The coder can use these CDN libraries - recommend them in your plan:\n\n" +

    "📊 DATA VISUALIZATION:\n" +
    "• Chart.js - Bar, line, pie, doughnut, radar charts\n" +
    "• Plotly - Interactive scientific charts with zoom/pan\n" +
    "• ApexCharts - Modern animated charts\n" +
    "• D3.js - Custom data visualizations\n\n" +

    "📋 DATA HANDLING:\n" +
    "• Papa Parse - Parse CSV files\n" +
    "• SheetJS - Parse Excel/XLSX files\n" +
    "• Lodash - Data manipulation (groupBy, sortBy, filter)\n" +
    "• Fuse.js - Fuzzy search\n\n" +

    "📋 TABLES:\n" +
    "• Tabulator - Interactive tables with sorting/filtering/editing\n" +
    "• Grid.js - Lightweight data tables\n\n" +

    "🎨 UI & STYLING:\n" +
    "• Tailwind CSS - Utility classes\n" +
    "• DaisyUI - Pre-built components\n" +
    "• SweetAlert2 - Beautiful popups\n" +
    "• Tippy.js - Tooltips\n\n" +

    "🛠️ UTILITIES:\n" +
    "• Day.js - Date formatting\n" +
    "• jsPDF - Generate PDFs\n" +
    "• html2canvas - Screenshots\n" +
    "• Sortable.js - Drag and drop\n\n" +

    "🤖 AI HELPER FUNCTION:\n" +
    "• window.geaRuntimeLLM(prompt) - Call AI from the generated app\n" +
    "• Returns a string response from the AI\n" +
    "• Use for: data analysis, text generation, suggestions, Q&A\n" +
    "• Example: const summary = await window.geaRuntimeLLM('Summarize this data: ' + JSON.stringify(data));\n\n" +

    "=== SECURITY RESTRICTIONS ===\n" +
    "Apps run in a sandboxed iframe. These are BLOCKED:\n" +
    "❌ fetch(), axios, XMLHttpRequest (use window.geaRuntimeLLM for AI)\n" +
    "❌ <iframe>, <embed>, <object>\n" +
    "❌ External image URLs (use CSS backgrounds or SVG)\n" +
    "❌ WebSockets, window.location changes\n" +
    "❌ External form submissions\n\n" +

    "=== JSON SCHEMA ===\n" +
    JSON.stringify(example, null, 2) + "\n\n" +

    "=== USER REQUEST ===\n" +
    userPrompt +
    extra
  );
}

function buildCoderPrompt(userPrompt, plan, extraDirections = "", librariesText = "") {
  const extra = extraDirections ? `\nAdditional guidance:\n${extraDirections}\n` : "";

  // Use dynamically loaded libraries or fallback to basic info
  const librariesSection = librariesText ||
    "📊 CHARTS: Chart.js, D3.js, Plotly, ECharts (via CDN)\n" +
    "🎨 STYLING: Tailwind CSS, Google Fonts\n" +
    "🔣 ICONS: Material Symbols, Font Awesome\n" +
    "🤖 AI: Use window.geaRuntimeLLM('prompt') for AI features\n";

  return (
    "You are a senior front-end engineer for GE Appliances.\n\n" +

    "=== CRITICAL: OUTPUT FORMAT ===\n" +
    "Output ONLY the raw HTML code. Your entire response must be valid HTML.\n" +
    "• Start with <!DOCTYPE html> or <html>\n" +
    "• Do NOT include markdown code fences (```)\n" +
    "• Do NOT include explanations, thinking, or commentary\n" +
    "• Do NOT include phrases like 'Here is the code' or 'I'll create'\n" +
    "• ONLY output the HTML document itself\n\n" +

    "=== AVAILABLE LIBRARIES (via CDN) ===\n" +
    librariesSection +
    "\n" +

    "=== AI HELPER FUNCTION ===\n" +
    "You have access to an AI assistant via a built-in function:\n\n" +
    "  const response = await window.geaRuntimeLLM('Your prompt here');\n\n" +
    "• This is the ONLY way to call AI - do NOT use fetch() for AI calls\n" +
    "• Returns a string response\n" +
    "• Use for: analyzing data, generating text, answering questions, making suggestions\n" +
    "• Example:\n" +
    "  const analysis = await window.geaRuntimeLLM(\n" +
    "    'Analyze this sales data and identify trends: ' + JSON.stringify(data)\n" +
    "  );\n" +
    "• Always wrap in try/catch and show loading states\n\n" +

    "=== SECURITY: FORBIDDEN PATTERNS ===\n" +
    "These will cause errors - DO NOT USE:\n" +
    "❌ fetch(), axios, XMLHttpRequest\n" +
    "❌ <iframe>, <embed>, <object>\n" +
    "❌ WebSocket connections\n" +
    "❌ window.location = or document.location =\n" +
    "❌ <meta http-equiv=\"refresh\">\n" +
    "❌ External image URLs (use CSS gradients or SVG instead)\n\n" +

    "=== STRUCTURE REQUIREMENTS ===\n" +
    "• Single HTML file with inline <style> and <script>\n" +
    "• Use Tailwind CSS from CDN for styling\n" +
    "• Use modern ES6+ JavaScript\n" +
    "• Make it responsive with CSS Grid/Flexbox\n" +
    "• Include loading states and error handling\n" +
    "• GE Brand Colors: Primary #007a8a, Dark #005f6b, Accent #f39200\n\n" +

    "=== CRITICAL: LIBRARY LOADING ===\n" +
    "⚠️ You MUST include <script src='...'> tags in <head> for EVERY library you use!\n" +
    "Example - if using Lodash, Papa Parse, and Chart.js:\n" +
    "<head>\n" +
    "  <script src='https://cdn.tailwindcss.com'></script>\n" +
    "  <script src='https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js'></script>\n" +
    "  <script src='https://cdn.jsdelivr.net/npm/papaparse@5/papaparse.min.js'></script>\n" +
    "  <script src='https://cdn.jsdelivr.net/npm/chart.js'></script>\n" +
    "</head>\n" +
    "If you reference _ (Lodash), Papa, Chart, ss (simple-statistics), etc. - include their CDN!\n\n" +

    extra +
    "=== USER REQUEST ===\n" +
    userPrompt +
    "\n\n" +
    "=== PLAN TO IMPLEMENT ===\n" +
    JSON.stringify(plan, null, 2) +
    "\n\n" +
    "Now output ONLY the HTML code, starting with <!DOCTYPE html>:"
  );
}

function ensureCspMeta(html) {
  const hasCsp = /content-security-policy/i.test(html);
  if (hasCsp) return html;

  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">`;
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n  ${meta}`);
  }
  return `${meta}\n${html}`;
}

function injectRuntimeHelpers(html, runtimeModel) {
  const helperId = "gea-runtime-helper";
  if (html.includes(helperId)) return html;

  const encodedModel = JSON.stringify(runtimeModel || RUNTIME_MODEL);
  const helperScript = `\n<script id="${helperId}">\n(function () {\n  if (window.geaRuntimeLLM) return;\n  const defaultModel = ${encodedModel};\n  async function callRuntimeLLM(prompt, options = {}) {\n    if (!prompt || typeof prompt !== "string") {\n      throw new Error("Prompt must be a non-empty string");\n    }\n    const model = typeof options.model === 'string' && options.model.trim() ? options.model.trim() : defaultModel;\n    const response = await fetch('/api/runtime/llm', {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify({ prompt, model }),\n      signal: options.signal\n    });\n    if (!response.ok) {\n      const error = await response.json().catch(() => ({}));\n      throw new Error(error && error.error ? error.error : 'Runtime LLM request failed');\n    }\n    const data = await response.json().catch(() => ({}));\n    return data && data.response ? data.response : '';\n  }\n  window.geaRuntimeLLM = callRuntimeLLM;\n})();\n</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${helperScript}\n</body>`);
  }
  if (/<\/html>/i.test(html)) {
    return html.replace(/<\/html>/i, `${helperScript}\n</html>`);
  }
  return `${html}${helperScript}`;
}

function trimHtmlForPrompt(html, maxLength = MAX_HTML_CONTEXT_CHARS) {
  if (!html) return "";
  if (html.length <= maxLength) return html;
  const remaining = html.length - maxLength;
  return `${html.slice(0, maxLength)}\n<!-- trimmed ${remaining} chars -->`;
}

async function requestPlan(
  prompt,
  extraDirections = "",
  modelName = PLANNER_MODEL,
  { maxAttempts = 2 } = {}
) {
  let lastRaw = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const planStart = Date.now();
    const guidance =
      attempt > 1
        ? `${extraDirections ? `${extraDirections}\n\n` : ""}Previous attempt returned invalid JSON. Respond with ONLY valid JSON matching the schema. No prose, no markdown.`
        : extraDirections;
    const raw = await callLLM(modelName, buildPlannerPrompt(prompt, guidance));
    lastRaw = raw;
    try {
      const plan = tryParseJson(raw);
      const durationMs = Date.now() - planStart;
      return { plan, raw, durationMs, model: modelName };
    } catch (err) {
      if (attempt === maxAttempts) {
        err.raw = err.raw || raw;
        throw err;
      }
    }
  }
  const error = new Error("Planner returned invalid JSON.");
  error.code = "INVALID_PLAN";
  error.raw = lastRaw;
  throw error;
}

async function requestHtml(
  prompt,
  plan,
  extraDirections = "",
  coderModel = CODER_MODEL,
  runtimeModel = RUNTIME_MODEL
) {
  const codeStart = Date.now();

  // Load libraries from JSON file
  const libs = await loadLibraries();
  const librariesText = formatLibrariesForPrompt(libs);

  let html = await callLLM(coderModel, buildCoderPrompt(prompt, plan, extraDirections, librariesText));
  html = ensureCspMeta(html);

  const unsafeReason = checkUnsafeHtml(html);
  if (unsafeReason) {
    throw new UnsafeHtmlError(unsafeReason);
  }

  html = injectRuntimeHelpers(html, runtimeModel);
  const durationMs = Date.now() - codeStart;
  return { html, durationMs, model: coderModel };
}

async function generateHtmlWithRetries(
  prompt,
  plan,
  { maxAttempts = 2, coderModel = CODER_MODEL, runtimeModel = RUNTIME_MODEL } = {}
) {
  let lastReason = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const extraDirections =
      attempt > 1 && lastReason
        ? `Previous attempt was rejected because: ${lastReason}. Remove any forbidden APIs (fetch/XMLHttpRequest/WebSocket/meta refresh) and only call the runtime helper window.geaRuntimeLLM when you need AI.`
        : "";
    try {
      return await requestHtml(prompt, plan, extraDirections, coderModel, runtimeModel);
    } catch (err) {
      if (err.code === "UNSAFE_HTML" && attempt < maxAttempts) {
        lastReason = err.message;
        continue;
      }
      throw err;
    }
  }
  throw new UnsafeHtmlError(lastReason || "Generated HTML rejected due to forbidden patterns.");
}

function checkUnsafeHtml(html) {
  const checks = [
    { label: "iframe", re: /<\s*iframe\b/i },
    { label: "object", re: /<\s*object\b/i },
    { label: "embed", re: /<\s*embed\b/i },
    { label: "fetch", re: /\bfetch\s*\(/i },
    { label: "XMLHttpRequest", re: /XMLHttpRequest/i },
    { label: "WebSocket", re: /WebSocket/i },
    { label: "meta refresh", re: /<meta[^>]+http-equiv\s*=\s*["']?refresh/i },
    { label: "window.location", re: /window\.location\s*=/i },
    { label: "document.location", re: /document\.location\s*=/i },
  ];

  for (const check of checks) {
    if (check.re.test(html)) {
      return `Generated HTML rejected due to forbidden pattern: ${check.label}`;
    }
  }
  return null;
}

async function saveRun({ prompt, plan, html, durations, models, timestamp }) {
  const runId = timestamp || timestampId();
  const runDir = path.join(RUNS_DIR, runId);
  await fs.mkdir(runDir, { recursive: true });

  await fs.writeFile(path.join(runDir, "prompt.txt"), prompt, "utf8");
  await fs.writeFile(path.join(runDir, "plan.json"), JSON.stringify(plan, null, 2), "utf8");
  await fs.writeFile(path.join(runDir, "page.html"), html, "utf8");
  await fs.writeFile(
    path.join(runDir, "meta.json"),
    JSON.stringify(
      {
        timestamp: runId,
        models:
          models ||
          {
            planner: PLANNER_MODEL,
            coder: CODER_MODEL,
            runtime: RUNTIME_MODEL,
          },
        durations_ms: durations,
      },
      null,
      2
    ),
    "utf8"
  );

  return runId;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", async (req, res) => {
  // Fetch models from Groq API if using Groq provider
  let availableModels = AVAILABLE_MODELS;
  if (LLM_PROVIDER === "groq") {
    const groqModels = await fetchGroqModels();
    if (groqModels.length > 0) {
      availableModels = groqModels;
    }
  }

  res.json({
    provider: LLM_PROVIDER,
    models: {
      planner: PLANNER_MODEL,
      coder: CODER_MODEL,
      runtime: RUNTIME_MODEL,
    },
    available_models: availableModels,
  });
});

app.post("/api/runtime/llm", async (req, res) => {
  const prompt = String(req.body && req.body.prompt ? req.body.prompt : "").trim();
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });
  const requestedModel = resolveModelName(req.body && req.body.model, RUNTIME_MODEL);

  try {
    const response = await callLLM(requestedModel, prompt);
    res.json({ response, model: requestedModel });
  } catch (err) {
    res.status(500).json({ error: err.message || "Runtime LLM failed." });
  }
});

app.get("/", async (req, res) => {
  try {
    await fs.access(DASHBOARD_HTML);
    res.sendFile(DASHBOARD_HTML);
  } catch (err) {
    res.status(500).send("Dashboard UI not found. Make sure the stitch folder exists.");
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/runs", async (req, res) => {
  try {
    const entries = await fs.readdir(RUNS_DIR, { withFileTypes: true }).catch(() => []);
    const runs = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const timestamp = entry.name;
      const runDir = path.join(RUNS_DIR, timestamp);
      let meta = null;
      let prompt = "";

      try {
        const rawMeta = await fs.readFile(path.join(runDir, "meta.json"), "utf8");
        meta = JSON.parse(rawMeta);
      } catch (err) {
        meta = null;
      }

      try {
        prompt = await fs.readFile(path.join(runDir, "prompt.txt"), "utf8");
      } catch (err) {
        prompt = "";
      }

      runs.push({
        timestamp,
        prompt_preview: prompt.trim().slice(0, 160),
        models: meta && meta.models ? meta.models : null,
        durations_ms: meta && meta.durations_ms ? meta.durations_ms : null,
      });
    }

    runs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: "Failed to list runs." });
  }
});

app.get("/api/run/:timestamp", async (req, res) => {
  const timestamp = String(req.params.timestamp || "");
  if (!timestamp) return res.status(400).json({ error: "Missing timestamp." });

  const runDir = path.join(RUNS_DIR, timestamp);
  try {
    const [prompt, planRaw, html, metaRaw] = await Promise.all([
      fs.readFile(path.join(runDir, "prompt.txt"), "utf8"),
      fs.readFile(path.join(runDir, "plan.json"), "utf8"),
      fs.readFile(path.join(runDir, "page.html"), "utf8"),
      fs.readFile(path.join(runDir, "meta.json"), "utf8").catch(() => null),
    ]);

    const plan = JSON.parse(planRaw);
    const meta = metaRaw ? JSON.parse(metaRaw) : null;

    res.json({
      timestamp,
      prompt,
      plan,
      html,
      meta,
      html_url: `/api/run/${timestamp}/page.html`,
    });
  } catch (err) {
    res.status(404).json({ error: "Run not found." });
  }
});

// Enhance prompt with AI before planning
app.post("/api/enhance", async (req, res) => {
  const prompt = String(req.body && req.body.prompt ? req.body.prompt : "").trim();
  const attachedData = String(req.body && req.body.attached_data ? req.body.attached_data : "").trim();

  if (!prompt) return res.status(400).json({ error: "Prompt is required." });

  const enhancerModel = resolveModelName(req.body && req.body.enhancer_model, PLANNER_MODEL);

  try {
    const enhanceStart = Date.now();
    const enhancedPrompt = await callLLM(enhancerModel, buildEnhancerPrompt(prompt, attachedData));
    const durationMs = Date.now() - enhanceStart;

    res.json({
      original_prompt: prompt,
      enhanced_prompt: enhancedPrompt.trim(),
      model: enhancerModel,
      duration_ms: durationMs
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Enhancement failed." });
  }
});

app.post("/api/plan", async (req, res) => {
  const prompt = String(req.body && req.body.prompt ? req.body.prompt : "").trim();
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });
  const plannerModel = resolveModelName(req.body && req.body.planner_model, PLANNER_MODEL);

  try {
    const { plan, raw, model } = await requestPlan(prompt, "", plannerModel);
    res.json({ plan, raw, model });
  } catch (err) {
    if (err.code === "INVALID_PLAN") {
      return res.status(500).json({ error: err.message, raw: err.raw });
    }
    res.status(500).json({ error: err.message || "Planner failed." });
  }
});

app.post("/api/generate", async (req, res) => {
  const prompt = String(req.body && req.body.prompt ? req.body.prompt : "").trim();
  const plan = req.body && req.body.plan ? req.body.plan : null;
  const shouldSave = Boolean(req.body && req.body.save);
  const planMs = Number.isFinite(req.body && req.body.plan_ms) ? req.body.plan_ms : null;
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });
  if (!plan) return res.status(400).json({ error: "Plan is required." });

  const plannerModel = resolveModelName(req.body && req.body.planner_model, PLANNER_MODEL);
  const coderModel = resolveModelName(req.body && req.body.coder_model, CODER_MODEL);
  const runtimeModel = resolveModelName(req.body && req.body.runtime_model, RUNTIME_MODEL);

  try {
    const { html, durationMs: codeMs } = await generateHtmlWithRetries(prompt, plan, {
      maxAttempts: 2,
      coderModel,
      runtimeModel,
    });

    let timestamp = null;
    if (shouldSave) {
      const durations = {
        planner: planMs,
        coder: codeMs,
        total: planMs != null ? planMs + codeMs : codeMs,
      };
      const models = { planner: plannerModel, coder: coderModel, runtime: runtimeModel };
      timestamp = await saveRun({ prompt, plan, html, durations, models });
    }

    res.json({ html, timestamp });
  } catch (err) {
    if (err.code === "UNSAFE_HTML") {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || "Code generation failed." });
  }
});

app.post("/api/iterate", async (req, res) => {
  const basePrompt = String(req.body && req.body.base_prompt ? req.body.base_prompt : "").trim();
  const changesPrompt = String(
    req.body && req.body.changes_prompt ? req.body.changes_prompt : ""
  ).trim();
  const planInput = req.body && req.body.plan ? req.body.plan : null;
  const plan = typeof planInput === "string" ? safeParseJson(planInput) : planInput;
  const html = String(req.body && req.body.html ? req.body.html : "");

  if (!plan || typeof plan !== "object") {
    return res.status(400).json({ error: "Valid plan JSON is required." });
  }
  if (!changesPrompt) {
    return res.status(400).json({ error: "Changes prompt is required." });
  }

  const plannerModel = resolveModelName(req.body && req.body.planner_model, PLANNER_MODEL);
  const coderModel = resolveModelName(req.body && req.body.coder_model, CODER_MODEL);
  const runtimeModel = resolveModelName(req.body && req.body.runtime_model, RUNTIME_MODEL);

  const iterationContextSections = [];
  if (basePrompt) {
    iterationContextSections.push(`Original prompt:\n${basePrompt}`);
  }
  iterationContextSections.push(
    `Current plan JSON:\n${JSON.stringify(plan, null, 2)}`
  );
  if (html) {
    iterationContextSections.push(
      `Current HTML output (trimmed for context):\n${trimHtmlForPrompt(html)}`
    );
  }
  iterationContextSections.push(`Requested changes:\n${changesPrompt}`);

  const iterationPrompt = iterationContextSections.join("\n\n");
  const iterationGuidance =
    "You are refining an existing experience. Preserve useful structure but create a fresh, complete plan that satisfies the requested changes.";

  let planResult;
  try {
    planResult = await requestPlan(iterationPrompt, iterationGuidance, plannerModel);
  } catch (err) {
    if (err.code === "INVALID_PLAN") {
      return res.status(500).json({ error: err.message, raw: err.raw });
    }
    return res.status(500).json({ error: err.message || "Planner failed." });
  }

  const mergedPrompt = basePrompt
    ? `${basePrompt}\n\nIteration request:\n${changesPrompt}`
    : `Iteration request:\n${changesPrompt}`;

  try {
    const { html: newHtml, durationMs: codeMs } = await generateHtmlWithRetries(
      mergedPrompt,
      planResult.plan,
      {
        maxAttempts: 2,
        coderModel,
        runtimeModel,
      }
    );
    const models = {
      planner: planResult.model || plannerModel,
      coder: coderModel,
      runtime: runtimeModel,
    };
    const durations = {
      planner: planResult.durationMs,
      coder: codeMs,
      total: planResult.durationMs != null ? planResult.durationMs + codeMs : codeMs,
    };
    const timestamp = await saveRun({
      prompt: mergedPrompt,
      plan: planResult.plan,
      html: newHtml,
      durations,
      models,
    });

    return res.json({
      plan: planResult.plan,
      html: newHtml,
      timestamp,
      prompt: mergedPrompt,
      models,
    });
  } catch (err) {
    if (err.code === "UNSAFE_HTML") {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message || "Iteration failed." });
  }
});

app.post("/api/pipeline", async (req, res) => {
  const prompt = String(req.body && req.body.prompt ? req.body.prompt : "").trim();
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });

  const plannerModel = resolveModelName(req.body && req.body.planner_model, PLANNER_MODEL);
  const coderModel = resolveModelName(req.body && req.body.coder_model, CODER_MODEL);
  const runtimeModel = resolveModelName(req.body && req.body.runtime_model, RUNTIME_MODEL);

  const startedAt = Date.now();
  const MAX_PLAN_ATTEMPTS = 2;
  let lastUnsafeReason = "";

  for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
    const extraDirections =
      attempt > 1 && lastUnsafeReason
        ? `Previous pipeline attempt failed because: ${lastUnsafeReason}. Revise the plan to avoid features requiring forbidden APIs (fetch/XMLHttpRequest/WebSocket/meta refresh) and make sure any AI requests go through window.geaRuntimeLLM.`
        : "";

    let planResult;
    try {
      planResult = await requestPlan(prompt, extraDirections, plannerModel);
    } catch (err) {
      if (err.code === "INVALID_PLAN") {
        return res.status(500).json({ error: err.message, raw: err.raw });
      }
      return res.status(500).json({ error: err.message || "Planner failed." });
    }

    try {
      const { html, durationMs: codeMs } = await generateHtmlWithRetries(prompt, planResult.plan, {
        maxAttempts: 2,
        coderModel,
        runtimeModel,
      });
      const totalMs = Date.now() - startedAt;
      const models = {
        planner: planResult.model || plannerModel,
        coder: coderModel,
        runtime: runtimeModel,
      };
      const timestamp = await saveRun({
        prompt,
        plan: planResult.plan,
        html,
        durations: { planner: planResult.durationMs, coder: codeMs, total: totalMs },
        models,
      });

      return res.json({ plan: planResult.plan, html, timestamp, models });
    } catch (err) {
      if (err.code === "UNSAFE_HTML") {
        lastUnsafeReason = err.message;
        if (attempt === MAX_PLAN_ATTEMPTS) {
          return res.status(400).json({ error: err.message });
        }
        continue;
      }
      return res.status(500).json({ error: err.message || "Pipeline failed." });
    }
  }
});

app.get("/api/run/:timestamp/page.html", async (req, res) => {
  const timestamp = String(req.params.timestamp || "");
  if (!timestamp) return res.status(400).send("Missing timestamp");

  const filePath = path.join(RUNS_DIR, timestamp, "page.html");
  try {
    const html = await fs.readFile(filePath, "utf8");
    res.type("html").send(html);
  } catch (err) {
    res.status(404).send("Not found");
  }
});

app.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`Server running on http://${displayHost}:${PORT}`);
});
