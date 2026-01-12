const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const dotenv = require("dotenv");
const { jsonrepair } = require("jsonrepair");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0"; // allow overriding host for restricted environments
const PLANNER_MODEL = process.env.PLANNER_MODEL || "llama3.1";
const CODER_MODEL = process.env.CODER_MODEL || "llama3.1";
const RUNTIME_MODEL = process.env.RUNTIME_MODEL || CODER_MODEL;
const MODEL_OPTIONS = (process.env.MODEL_OPTIONS || "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const RUNS_DIR = path.join(__dirname, "runs");
const DASHBOARD_HTML = path.join(__dirname, "public", "index.html");
const OLLAMA_URL = "http://localhost:11434/api/generate";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || "0") || 120000;
const CSP_CONTENT =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self' http://localhost:* http://127.0.0.1:*; base-uri 'none'; form-action 'none';";
const AVAILABLE_MODELS = Array.from(
  new Set([PLANNER_MODEL, CODER_MODEL, RUNTIME_MODEL, ...MODEL_OPTIONS])
);

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

    if (data.error) {
      const message = data.error;
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

function buildPlannerPrompt(userPrompt, extraDirections = "") {
  const example = {
    title: "...",
    description: "...",
    pages: [{ name: "Home", purpose: "..." }],
    ui_components: ["..."],
    state: ["..."],
    interactions: ["..."],
    acceptance_criteria: ["..."],
  };

  const extra = extraDirections ? `\n\nAdditional guidance:\n${extraDirections}` : "";

  return (
    "You are an experienced front-end product planner tasked with designing a complete single-page web experience directly from the user's prompt.\n" +
    "Output MUST be valid JSON matching the schema—no markdown fences or commentary.\n" +
    "Spell out user goals, main sections, UI components, state, and interactions so an engineer can implement it verbatim.\n\n" +
    "User prompt:\n" +
    userPrompt +
    "\n\n" +
    "JSON schema example:\n" +
    JSON.stringify(example, null, 2) +
    extra
  );
}

function buildCoderPrompt(userPrompt, plan, extraDirections = "") {
  const extra = extraDirections ? `\nAdditional guidance:\n${extraDirections}\n` : "";
  return (
    "You are an expert front-end engineer implementing the plan below exactly as written. Output ONLY the final HTML document—no markdown or commentary.\n" +
    "Create a single standalone HTML file that delivers every section, component, state hook, and interaction called out in the plan.\n" +
    "Requirements:\n" +
    "- Inline CSS in <style> and inline JS in <script>\n" +
    "- No external resources or CDNs\n" +
    "- Include a CSP meta tag: <meta http-equiv=\"Content-Security-Policy\" content=\"" +
    CSP_CONTENT +
    "\">\n" +
    "- Keep JS simple and local-only\n" +
    "- To call the runtime LLM, use: await window.geaRuntimeLLM(prompt)\n" +
    "- Do NOT call fetch/XMLHttpRequest/WebSocket yourself\n\n" +
    "Implementation notes:\n" +
    "- Follow the provided plan literally for layout, components, state, and user flows.\n" +
    "- Provide sensible placeholder copy/data where the plan references content.\n" +
    "- Ensure IDs/classes referenced in JS exist in the markup and that interactions are wired up.\n\n" +
    extra +
    "User prompt:\n" +
    userPrompt +
    "\n\n" +
    "Plan JSON:\n" +
    JSON.stringify(plan, null, 2)
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
    const raw = await callOllama(modelName, buildPlannerPrompt(prompt, guidance));
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
  let html = await callOllama(coderModel, buildCoderPrompt(prompt, plan, extraDirections));
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

app.get("/api/config", (req, res) => {
  res.json({
    models: {
      planner: PLANNER_MODEL,
      coder: CODER_MODEL,
      runtime: RUNTIME_MODEL,
    },
    available_models: AVAILABLE_MODELS,
  });
});

app.post("/api/runtime/llm", async (req, res) => {
  const prompt = String(req.body && req.body.prompt ? req.body.prompt : "").trim();
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });
  const requestedModel = resolveModelName(req.body && req.body.model, RUNTIME_MODEL);

  try {
    const response = await callOllama(requestedModel, prompt);
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
