// ======================================
// GE AI Tool - Enhanced JavaScript
// ======================================

// DOM Elements
const statusEl = document.getElementById("status");
const promptInput = document.getElementById("promptInput");
const promptDisplay = document.getElementById("promptDisplay");
const planOutput = document.getElementById("planOutput");
const htmlOutput = document.getElementById("htmlOutput");
const previewFrame = document.getElementById("previewFrame");
const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const iterateInput = document.getElementById("iterateInput");
const iterateBtn = document.getElementById("iterateBtn");
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
const runLoadBtn = document.getElementById("runLoadBtn");
const plannerModelSelect = document.getElementById("plannerModel");
const coderModelSelect = document.getElementById("coderModel");
const runtimeModelSelect = document.getElementById("runtimeModel");
const progressSteps = document.getElementById("progressSteps");
const toastContainer = document.getElementById("toastContainer");

// State
let latestHtml = "";
let latestPlan = null;
let latestPromptText = "";
let latestRunHtml = "";
let appConfig = null;
let selectedRunDetails = null;
let isGenerating = false;

// ======================================
// Toast Notifications
// ======================================
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  // Add icon based on type
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  toast.innerHTML = `<span class="toast-icon">${icon}</span> ${message}`;
  
  if (toastContainer) {
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}

// ======================================
// Status Management
// ======================================
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", Boolean(isError));
}

// ======================================
// Progress Steps
// ======================================
function showProgress(show = true) {
  if (progressSteps) {
    progressSteps.style.display = show ? "flex" : "none";
  }
}

function setProgressStep(step) {
  if (!progressSteps) return;
  
  const steps = progressSteps.querySelectorAll(".progress-step");
  const stepOrder = ["plan", "code", "done"];
  const currentIndex = stepOrder.indexOf(step);
  
  steps.forEach((stepEl, i) => {
    const stepName = stepEl.dataset.step;
    const stepIndex = stepOrder.indexOf(stepName);
    
    stepEl.classList.remove("active", "done");
    
    if (stepIndex < currentIndex) {
      stepEl.classList.add("done");
    } else if (stepIndex === currentIndex) {
      stepEl.classList.add("active");
    }
  });
}

// ======================================
// Health Check
// ======================================
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

// ======================================
// Preview Management
// ======================================
function updatePreview(html) {
  previewFrame.srcdoc = html;
}

// ======================================
// Button State Management
// ======================================
function setButtonsEnabled(enabled) {
  copyBtn.disabled = !enabled;
  downloadBtn.disabled = !enabled;
}

function setGenerating(generating) {
  isGenerating = generating;
  generateBtn.disabled = generating;
  
  if (generating) {
    generateBtn.innerHTML = '<span class="spinner"></span> Generating...';
  } else {
    generateBtn.innerHTML = '<span class="btn-icon">🚀</span> Generate';
  }
}

function refreshIterationControls() {
  const ready = Boolean(latestPlan && latestHtml);
  iterateBtn.disabled = !ready;
  iterateInput.disabled = !ready;
  if (!ready) {
    iterateInput.value = "";
  }
}

function setRunButtonsEnabled(enabled) {
  runCopyBtn.disabled = !enabled;
  runDownloadBtn.disabled = !enabled;
}

function setRunLoadEnabled(enabled) {
  runLoadBtn.disabled = !enabled;
}

// ======================================
// Tab Management
// ======================================
function setActiveTab(tabName) {
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  });
}

// ======================================
// Model Selection
// ======================================
function populateModelSelect(selectEl, options, selectedValue) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option;
    opt.textContent = option;
    if (option === selectedValue) {
      opt.selected = true;
    }
    selectEl.appendChild(opt);
  });
}

function getSelectedModels() {
  return {
    planner: plannerModelSelect ? plannerModelSelect.value.trim() : "",
    coder: coderModelSelect ? coderModelSelect.value.trim() : "",
    runtime: runtimeModelSelect ? runtimeModelSelect.value.trim() : "",
  };
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load config");
    appConfig = data;
  } catch (err) {
    appConfig = {
      models: { planner: "", coder: "", runtime: "" },
      available_models: [],
    };
  }

  const options = (appConfig && appConfig.available_models && appConfig.available_models.length
    ? appConfig.available_models
    : ["llama3.1"]
  ).sort();

  populateModelSelect(plannerModelSelect, options, appConfig?.models?.planner || options[0]);
  populateModelSelect(coderModelSelect, options, appConfig?.models?.coder || options[0]);
  populateModelSelect(runtimeModelSelect, options, appConfig?.models?.runtime || options[0]);
}

// ======================================
// Runs Management
// ======================================
function formatTimestamp(timestamp) {
  try {
    const date = new Date(timestamp.replace(/_/g, ':').replace(/-/g, '/'));
    if (isNaN(date)) return timestamp;
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return timestamp;
  }
}

async function loadRuns() {
  runsList.innerHTML = '<div class="empty" style="border-style: solid;">Loading runs...</div>';
  try {
    const res = await fetch("/api/runs");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load runs");

    if (!data.runs || data.runs.length === 0) {
      runsList.innerHTML = '<div class="empty">No runs yet. Create one to see it here.</div>';
      return;
    }

    runsList.innerHTML = "";
    data.runs.forEach((run) => {
      const button = document.createElement("button");
      button.className = "run-item";
      button.type = "button";
      button.innerHTML = `
        <div class="run-title">${formatTimestamp(run.timestamp)}</div>
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
  setRunLoadEnabled(false);
  selectedRunDetails = null;

  try {
    const res = await fetch(`/api/run/${timestamp}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load run");

    const meta = data.meta || {};
    const models = meta.models
      ? `Planner: ${meta.models.planner}, Coder: ${meta.models.coder}`
      : "Models: -";
    const durations = meta.durations_ms
      ? `Time: ${Math.round(meta.durations_ms.total / 1000)}s`
      : "";

    runMeta.textContent = `${formatTimestamp(data.timestamp)} • ${models} ${durations ? '• ' + durations : ''}`;
    runPrompt.textContent = data.prompt || "-";
    runPlan.textContent = JSON.stringify(data.plan, null, 2);
    latestRunHtml = data.html || "";
    runHtml.value = latestRunHtml;
    runPreview.srcdoc = latestRunHtml;
    setRunButtonsEnabled(Boolean(latestRunHtml));
    selectedRunDetails = data;
    setRunLoadEnabled(true);
  } catch (err) {
    runMeta.textContent = err.message || "Failed to load run.";
    selectedRunDetails = null;
    setRunLoadEnabled(false);
  }
}

// ======================================
// Pipeline Generation
// ======================================
async function generatePipeline() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus("Please enter a prompt.", true);
    showToast("Please enter a prompt first", "error");
    return;
  }

  if (isGenerating) return;

  promptDisplay.textContent = prompt;
  planOutput.textContent = "";
  htmlOutput.value = "";
  updatePreview("<html><body></body></html>");
  latestPlan = null;
  latestPromptText = "";
  latestHtml = "";
  setButtonsEnabled(false);
  refreshIterationControls();
  setGenerating(true);
  showProgress(true);
  
  const selectedModels = getSelectedModels();

  try {
    // Step 1: Planning
    setStatus("Planning your experience...", false);
    setProgressStep("plan");
    
    const planStart = performance.now();
    const planRes = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, planner_model: selectedModels.planner }),
    });

    const planData = await planRes.json();
    if (!planRes.ok) {
      throw new Error(planData.error || "Plan failed");
    }

    planOutput.textContent = JSON.stringify(planData.plan, null, 2);
    latestPlan = planData.plan;
    latestPromptText = prompt;
    const planMs = Math.round(performance.now() - planStart);
    const planModelUsed = planData.model || selectedModels.planner;

    // Step 2: Coding
    setStatus("Generating code...", false);
    setProgressStep("code");
    
    const genRes = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        plan: planData.plan,
        plan_ms: planMs,
        save: true,
        planner_model: planModelUsed,
        coder_model: selectedModels.coder,
        runtime_model: selectedModels.runtime,
      }),
    });

    const genData = await genRes.json();
    if (!genRes.ok) {
      throw new Error(genData.error || "Generation failed");
    }

    // Step 3: Done
    setProgressStep("done");
    latestHtml = genData.html || "";
    htmlOutput.value = latestHtml;
    updatePreview(latestHtml);
    setButtonsEnabled(Boolean(latestHtml));
    refreshIterationControls();
    setStatus("Generation complete!", false);
    showToast("Experience generated successfully!");
    
    if (genData.timestamp) {
      loadRuns();
    }
  } catch (err) {
    setStatus(err.message || "Something went wrong", true);
    showToast(err.message || "Generation failed", "error");
  } finally {
    setGenerating(false);
    setTimeout(() => showProgress(false), 2000);
  }
}

// ======================================
// Iteration
// ======================================
async function iterateOnBuild() {
  const changes = iterateInput.value.trim();
  if (!changes) {
    setStatus("Describe the changes you want first.", true);
    showToast("Please describe your changes", "error");
    return;
  }
  if (!latestPlan || !latestHtml) {
    setStatus("Generate a page before iterating.", true);
    showToast("Generate a page first", "error");
    return;
  }

  const selectedModels = getSelectedModels();
  iterateBtn.disabled = true;
  iterateBtn.innerHTML = '<span class="spinner"></span> Applying...';
  setStatus("Re-planning with your tweaks...", false);
  showProgress(true);
  setProgressStep("plan");

  try {
    const res = await fetch("/api/iterate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_prompt: latestPromptText,
        plan: latestPlan,
        html: latestHtml,
        changes_prompt: changes,
        planner_model: selectedModels.planner,
        coder_model: selectedModels.coder,
        runtime_model: selectedModels.runtime,
      }),
    });
    
    setProgressStep("code");
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Iteration failed");
    }

    setProgressStep("done");
    planOutput.textContent = JSON.stringify(data.plan, null, 2);
    latestPlan = data.plan;
    latestHtml = data.html || "";
    latestPromptText = data.prompt || latestPromptText;
    htmlOutput.value = latestHtml;
    updatePreview(latestHtml);
    setButtonsEnabled(Boolean(latestHtml));
    refreshIterationControls();
    iterateInput.value = "";
    promptDisplay.textContent = latestPromptText || "Iterated prompt";
    setStatus("Changes applied!", false);
    showToast("Changes applied successfully!");
    
    if (data.timestamp) {
      loadRuns();
    }
  } catch (err) {
    setStatus(err.message || "Iteration failed", true);
    showToast(err.message || "Iteration failed", "error");
  } finally {
    iterateBtn.innerHTML = '<span class="btn-icon">🔄</span> Apply Changes';
    refreshIterationControls();
    setTimeout(() => showProgress(false), 2000);
  }
}

// ======================================
// Load Run into Editor
// ======================================
function loadSelectedRunIntoEditor() {
  if (!selectedRunDetails) return;
  setActiveTab("create");
  const prompt = selectedRunDetails.prompt || "";
  promptInput.value = prompt;
  promptDisplay.textContent = prompt || "Loaded run";
  planOutput.textContent = JSON.stringify(selectedRunDetails.plan, null, 2);
  latestPlan = selectedRunDetails.plan;
  latestPromptText = prompt;
  latestHtml = selectedRunDetails.html || "";
  htmlOutput.value = latestHtml;
  updatePreview(latestHtml);
  setButtonsEnabled(Boolean(latestHtml));
  refreshIterationControls();
  iterateInput.focus();
  setStatus("Loaded run into editor", false);
  showToast("Run loaded into editor");
}

// ======================================
// Copy/Download Functions
// ======================================
async function copyHtml(html, successMessage = "HTML copied to clipboard!") {
  if (!html) return;
  try {
    await navigator.clipboard.writeText(html);
    showToast(successMessage);
  } catch (err) {
    showToast("Copy failed. Try manually selecting the text.", "error");
  }
}

function downloadHtml(html, filename = "generated.html") {
  if (!html) return;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("HTML downloaded!");
}

// ======================================
// Event Listeners
// ======================================
copyBtn.addEventListener("click", () => copyHtml(latestHtml));
downloadBtn.addEventListener("click", () => downloadHtml(latestHtml));
runCopyBtn.addEventListener("click", () => copyHtml(latestRunHtml));
runDownloadBtn.addEventListener("click", () => downloadHtml(latestRunHtml));

generateBtn.addEventListener("click", generatePipeline);
iterateBtn.addEventListener("click", iterateOnBuild);
refreshRunsBtn.addEventListener("click", loadRuns);
runLoadBtn.addEventListener("click", loadSelectedRunIntoEditor);

// Keyboard shortcuts
promptInput.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    generatePipeline();
  }
});

iterateInput.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    iterateOnBuild();
  }
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveTab(tab.dataset.tab);
    if (tab.dataset.tab === "runs") {
      loadRuns();
    }
  });
});

// ======================================
// Initialize
// ======================================
loadConfig();
checkHealth();
loadRuns();

// Periodic health check
setInterval(checkHealth, 30000);
