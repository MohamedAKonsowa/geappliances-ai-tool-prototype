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

let latestHtml = "";

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

generateBtn.addEventListener("click", generatePipeline);
checkHealth();
