const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const PLANNER_MODEL = process.env.PLANNER_MODEL || "llama3.1";
const CODER_MODEL = process.env.CODER_MODEL || "llama3.1";
const RUNS_DIR = path.join(__dirname, "runs");
const OLLAMA_URL = "http://localhost:11434/api/generate";
const LLM_TIMEOUT_MS = 60000;
const CSP_CONTENT = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none';";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

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

function buildPlannerPrompt(userPrompt) {
  const example = {
    title: "...",
    description: "...",
    pages: [{ name: "Home", purpose: "..." }],
    ui_components: ["..."],
    state: ["..."],
    interactions: ["..."],
    acceptance_criteria: ["..."],
  };

  return (
    "You are a software planner. Output ONLY valid JSON. No markdown.\n" +
    "Return a plan for a single-page web app. Keep it concise but complete.\n\n" +
    "User prompt:\n" +
    userPrompt +
    "\n\n" +
    "JSON schema example:\n" +
    JSON.stringify(example, null, 2)
  );
}

function buildCoderPrompt(userPrompt, plan) {
  return (
    "You are a code generator. Output ONLY the final HTML file. No markdown. No explanations.\n" +
    "Create a single standalone HTML document for the plan below.\n" +
    "Requirements:\n" +
    "- Inline CSS in <style> and inline JS in <script>\n" +
    "- No external resources or CDNs\n" +
    "- Include a CSP meta tag: <meta http-equiv=\"Content-Security-Policy\" content=\"" +
    CSP_CONTENT +
    "\">\n" +
    "- Keep JS simple and local-only\n\n" +
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

async function saveRun({ prompt, plan, html, durations, timestamp }) {
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
        models: { planner: PLANNER_MODEL, coder: CODER_MODEL },
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

app.post("/api/plan", async (req, res) => {
  const prompt = String(req.body && req.body.prompt ? req.body.prompt : "").trim();
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });

  try {
    const raw = await callOllama(PLANNER_MODEL, buildPlannerPrompt(prompt));
    let plan;
    try {
      plan = JSON.parse(raw);
    } catch (err) {
      return res.status(500).json({ error: "Planner returned invalid JSON.", raw });
    }
    res.json({ plan, raw });
  } catch (err) {
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

  try {
    const codeStart = Date.now();
    let html = await callOllama(CODER_MODEL, buildCoderPrompt(prompt, plan));
    html = ensureCspMeta(html);
    const codeMs = Date.now() - codeStart;

    const unsafeReason = checkUnsafeHtml(html);
    if (unsafeReason) return res.status(400).json({ error: unsafeReason });

    let timestamp = null;
    if (shouldSave) {
      const durations = {
        planner: planMs,
        coder: codeMs,
        total: planMs != null ? planMs + codeMs : codeMs,
      };
      timestamp = await saveRun({ prompt, plan, html, durations });
    }

    res.json({ html, timestamp });
  } catch (err) {
    res.status(500).json({ error: err.message || "Code generation failed." });
  }
});

app.post("/api/pipeline", async (req, res) => {
  const prompt = String(req.body && req.body.prompt ? req.body.prompt : "").trim();
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });

  const startedAt = Date.now();
  try {
    const planStart = Date.now();
    const raw = await callOllama(PLANNER_MODEL, buildPlannerPrompt(prompt));
    let plan;
    try {
      plan = JSON.parse(raw);
    } catch (err) {
      return res.status(500).json({ error: "Planner returned invalid JSON.", raw });
    }
    const planMs = Date.now() - planStart;

    const codeStart = Date.now();
    let html = await callOllama(CODER_MODEL, buildCoderPrompt(prompt, plan));
    html = ensureCspMeta(html);

    const unsafeReason = checkUnsafeHtml(html);
    if (unsafeReason) return res.status(400).json({ error: unsafeReason });

    const codeMs = Date.now() - codeStart;
    const totalMs = Date.now() - startedAt;

    const timestamp = await saveRun({
      prompt,
      plan,
      html,
      durations: { planner: planMs, coder: codeMs, total: totalMs },
    });

    res.json({ plan, html, timestamp });
  } catch (err) {
    res.status(500).json({ error: err.message || "Pipeline failed." });
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
