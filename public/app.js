const statusEl = document.getElementById("status");
const promptInput = document.getElementById("promptInput");
const promptDisplay = document.getElementById("promptDisplay");
const planOutput = document.getElementById("planOutput");
const htmlOutput = document.getElementById("htmlOutput");
const previewFrame = document.getElementById("previewFrame");
const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const healthDot = document.getElementById("healthDot");
const healthText = document.getElementById("healthText");
const tabs = document.querySelectorAll(".tab");
const tabPanels = document.querySelectorAll(".tab-panel");
const runsList = document.getElementById("runsList");
const refreshRunsBtn = document.getElementById("refreshRunsBtn");
const runMeta = document.getElementById("runMeta");
const runPrompt = document.getElementById("runPrompt");
const runPlan = document.getElementById("runPlan");
const runHtml = document.getElementById("runHtml");
const runPreview = document.getElementById("runPreview");
const runCopyBtn = document.getElementById("runCopyBtn");
const runDownloadBtn = document.getElementById("runDownloadBtn");

let latestHtml = "";
let latestRunHtml = "";

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", Boolean(isError));
}

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error("Bad response");
    healthDot.classList.add("ok");
    healthText.textContent = "Server online";
  } catch (err) {
    healthDot.classList.remove("ok");
    healthText.textContent = "Server offline";
  }
}

function updatePreview(html) {
  previewFrame.srcdoc = html;
}

function setButtonsEnabled(enabled) {
  copyBtn.disabled = !enabled;
  downloadBtn.disabled = !enabled;
}

function setRunButtonsEnabled(enabled) {
  runCopyBtn.disabled = !enabled;
  runDownloadBtn.disabled = !enabled;
}

function setActiveTab(tabName) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
}

async function loadRuns() {
  runsList.innerHTML = "<div class=\"empty\">Loading runs...</div>";
  try {
    const res = await fetch("/api/runs");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load runs");

    if (!data.runs || data.runs.length === 0) {
      runsList.innerHTML = "<div class=\"empty\">No runs yet. Create one to see it here.</div>";
      return;
    }

    runsList.innerHTML = "";
    data.runs.forEach((run) => {
      const button = document.createElement("button");
      button.className = "run-item";
      button.type = "button";
      button.innerHTML = `
        <div class="run-title">${run.timestamp}</div>
        <div class="run-snippet">${run.prompt_preview || "No prompt saved."}</div>
      `;
      button.addEventListener("click", () => loadRunDetails(run.timestamp));
      runsList.appendChild(button);
    });
  } catch (err) {
    runsList.innerHTML = `<div class="empty error">${err.message || "Failed to load runs."}</div>`;
  }
}

async function loadRunDetails(timestamp) {
  runMeta.textContent = "Loading run details...";
  runPrompt.textContent = "-";
  runPlan.textContent = "-";
  runHtml.value = "";
  runPreview.srcdoc = "<html><body></body></html>";
  setRunButtonsEnabled(false);

  try {
    const res = await fetch(`/api/run/${timestamp}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load run");

    const meta = data.meta || {};
    const models = meta.models ? `Planner: ${meta.models.planner}, Coder: ${meta.models.coder}` : "Models: -";
    const durations = meta.durations_ms
      ? `Durations (ms) - planner: ${meta.durations_ms.planner}, coder: ${meta.durations_ms.coder}, total: ${meta.durations_ms.total}`
      : "Durations: -";

    runMeta.textContent = `${data.timestamp} | ${models} | ${durations}`;
    runPrompt.textContent = data.prompt || "-";
    runPlan.textContent = JSON.stringify(data.plan, null, 2);
    latestRunHtml = data.html || "";
    runHtml.value = latestRunHtml;
    runPreview.srcdoc = latestRunHtml;
    setRunButtonsEnabled(Boolean(latestRunHtml));
  } catch (err) {
    runMeta.textContent = err.message || "Failed to load run.";
  }
}

async function generatePipeline() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus("Please enter a prompt.", true);
    return;
  }

  promptDisplay.textContent = prompt;
  planOutput.textContent = "";
  htmlOutput.value = "";
  updatePreview("<html><body></body></html>");
  setButtonsEnabled(false);

  try {
    setStatus("Planning...", false);
    const planStart = performance.now();
    const planRes = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    const planData = await planRes.json();
    if (!planRes.ok) {
      throw new Error(planData.error || "Plan failed");
    }

    planOutput.textContent = JSON.stringify(planData.plan, null, 2);
    const planMs = Math.round(performance.now() - planStart);

    setStatus("Coding...", false);
    const genRes = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, plan: planData.plan, plan_ms: planMs, save: true }),
    });

    const genData = await genRes.json();
    if (!genRes.ok) {
      throw new Error(genData.error || "Generation failed");
    }

    latestHtml = genData.html || "";
    htmlOutput.value = latestHtml;
    updatePreview(latestHtml);
    setButtonsEnabled(Boolean(latestHtml));
    setStatus("Done", false);
    if (genData.timestamp) {
      loadRuns();
    }
  } catch (err) {
    setStatus(err.message || "Something went wrong", true);
  }
}

copyBtn.addEventListener("click", async () => {
  if (!latestHtml) return;
  try {
    await navigator.clipboard.writeText(latestHtml);
    setStatus("HTML copied to clipboard.", false);
  } catch (err) {
    setStatus("Copy failed. Try manually selecting the text.", true);
  }
});

downloadBtn.addEventListener("click", () => {
  if (!latestHtml) return;
  const blob = new Blob([latestHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "generated.html";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

runCopyBtn.addEventListener("click", async () => {
  if (!latestRunHtml) return;
  try {
    await navigator.clipboard.writeText(latestRunHtml);
    runMeta.textContent = "HTML copied to clipboard.";
  } catch (err) {
    runMeta.textContent = "Copy failed. Try manually selecting the text.";
  }
});

runDownloadBtn.addEventListener("click", () => {
  if (!latestRunHtml) return;
  const blob = new Blob([latestRunHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "generated.html";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

generateBtn.addEventListener("click", generatePipeline);
refreshRunsBtn.addEventListener("click", loadRuns);

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveTab(tab.dataset.tab);
    if (tab.dataset.tab === "runs") {
      loadRuns();
    }
  });
});

checkHealth();
loadRuns();
