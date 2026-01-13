// ======================================
// GE App Creator Hub - JavaScript
// ======================================

// DOM Elements
const promptInput = document.getElementById('promptInput');
const generateBtn = document.getElementById('generateBtn');
const generateBtnText = document.getElementById('generateBtnText');
const generateBtnIcon = document.getElementById('generateBtnIcon');
const statusDots = document.getElementById('statusDots');
const statusText = document.getElementById('statusText');
const advancedPanel = document.getElementById('advancedPanel');
const plannerModel = document.getElementById('plannerModel');
const coderModel = document.getElementById('coderModel');
const runtimeModel = document.getElementById('runtimeModel');
const previewFrame = document.getElementById('previewFrame');
const previewStatus = document.getElementById('previewStatus');
const previewUrl = document.getElementById('previewUrl');
const planOutput = document.getElementById('planOutput');
const htmlOutput = document.getElementById('htmlOutput');
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const refreshPreview = document.getElementById('refreshPreview');
const iteratePanel = document.getElementById('iteratePanel');
const iterateInput = document.getElementById('iterateInput');
const iterateBtn = document.getElementById('iterateBtn');
const runsList = document.getElementById('runsList');
const refreshRunsBtn = document.getElementById('refreshRunsBtn');
const healthDot = document.getElementById('healthDot');
const healthText = document.getElementById('healthText');
const darkModeToggle = document.getElementById('darkModeToggle');
const toastContainer = document.getElementById('toastContainer');
const navCreate = document.getElementById('navCreate');
const navLibrary = document.getElementById('navLibrary');
const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
const enhanceToggle = document.getElementById('enhanceToggle');
const attachedFilesDisplay = document.getElementById('attachedFilesDisplay');

// State
let latestHtml = '';
let latestPlan = null;
let latestPromptText = '';
let isGenerating = false;
let appConfig = null;
let attachedFiles = [];
let attachedData = '';

// ======================================
// Toast Notifications
// ======================================
function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ======================================
// Dark Mode
// ======================================
function initDarkMode() {
  const isDark = localStorage.getItem('darkMode') === 'true';
  document.documentElement.classList.toggle('dark', isDark);
}

darkModeToggle.addEventListener('click', () => {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('darkMode', isDark);
});

// ======================================
// Health Check
// ======================================
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error();
    healthDot.className = 'size-2 rounded-full bg-green-500 animate-pulse';
    healthText.textContent = 'Online';
    healthText.className = 'text-xs font-bold text-green-600';
  } catch {
    healthDot.className = 'size-2 rounded-full bg-red-500';
    healthText.textContent = 'Offline';
    healthText.className = 'text-xs font-bold text-red-500';
  }
}

// ======================================
// Config & Models
// ======================================
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    appConfig = data;

    const options = data.available_models?.length ? data.available_models.sort() : ['llama3.1'];

    [plannerModel, coderModel, runtimeModel].forEach((select, i) => {
      select.innerHTML = '';
      const defaults = [data.models?.planner, data.models?.coder, data.models?.runtime];
      options.forEach(model => {
        const opt = document.createElement('option');
        opt.value = model;
        opt.textContent = model;
        if (model === defaults[i]) opt.selected = true;
        select.appendChild(opt);
      });
    });
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function getSelectedModels() {
  return {
    planner: plannerModel.value,
    coder: coderModel.value,
    runtime: runtimeModel.value
  };
}

// ======================================
// Progress Steps
// ======================================
function resetProgress() {
  ['plan', 'code', 'done'].forEach(step => {
    const icon = document.getElementById(`step-${step}-icon`);
    const title = document.getElementById(`step-${step}-title`);
    const desc = document.getElementById(`step-${step}-desc`);

    icon.className = 'size-7 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center shrink-0 border border-gray-200';
    icon.innerHTML = `<span class="text-xs font-bold">${step === 'plan' ? '1' : step === 'code' ? '2' : '3'}</span>`;
    title.className = 'text-[15px] font-bold text-gray-400 leading-none';
    desc.textContent = 'Waiting to start';
  });
}

function setProgressStep(activeStep, status = 'active') {
  const steps = ['plan', 'code', 'done'];
  const stepIndex = steps.indexOf(activeStep);

  steps.forEach((step, i) => {
    const icon = document.getElementById(`step-${step}-icon`);
    const title = document.getElementById(`step-${step}-title`);
    const desc = document.getElementById(`step-${step}-desc`);

    if (i < stepIndex) {
      // Completed
      icon.className = 'size-7 rounded-full bg-green-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-green-200';
      icon.innerHTML = '<span class="material-symbols-outlined text-lg">check</span>';
      title.className = 'text-[15px] font-bold text-gray-900 dark:text-white leading-none';
      desc.textContent = 'Completed';
    } else if (i === stepIndex) {
      // Active
      icon.className = 'size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0';
      icon.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span>';
      title.className = 'text-[15px] font-bold text-primary leading-none';
      desc.textContent = step === 'plan' ? 'Analyzing requirements...' : step === 'code' ? 'Designing user screens...' : 'Finalizing...';
    } else {
      // Pending
      icon.className = 'size-7 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center shrink-0 border border-gray-200 opacity-40';
      icon.innerHTML = `<span class="text-xs font-bold">${i + 1}</span>`;
      title.className = 'text-[15px] font-bold text-gray-400 leading-none opacity-40';
      desc.textContent = 'Waiting to start';
    }
  });
}

function completeProgress() {
  ['plan', 'code', 'done'].forEach(step => {
    const icon = document.getElementById(`step-${step}-icon`);
    const title = document.getElementById(`step-${step}-title`);
    const desc = document.getElementById(`step-${step}-desc`);

    icon.className = 'size-7 rounded-full bg-green-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-green-200';
    icon.innerHTML = '<span class="material-symbols-outlined text-lg">check</span>';
    title.className = 'text-[15px] font-bold text-gray-900 dark:text-white leading-none';
    desc.textContent = 'Completed';
  });
}

// ======================================
// Generation
// ======================================
function setGenerating(generating) {
  isGenerating = generating;
  generateBtn.disabled = generating;

  if (generating) {
    generateBtnText.textContent = 'Creating...';
    generateBtnIcon.textContent = 'hourglass_empty';
    generateBtnIcon.classList.add('animate-spin');
    statusDots.classList.remove('hidden');
  } else {
    generateBtnText.textContent = 'Create My App';
    generateBtnIcon.textContent = 'rocket_launch';
    generateBtnIcon.classList.remove('animate-spin');
    statusDots.classList.add('hidden');
  }
}

function setStatus(text) {
  statusText.textContent = text;
}

async function generatePipeline() {
  let prompt = promptInput.value.trim();
  if (!prompt) {
    showToast('Please describe the app you want to create', true);
    return;
  }

  if (isGenerating) return;

  setGenerating(true);
  resetProgress();
  latestHtml = '';
  latestPlan = null;
  latestPromptText = prompt;
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  iteratePanel.classList.add('hidden');

  const models = getSelectedModels();
  const shouldEnhance = enhanceToggle && enhanceToggle.checked;

  try {
    // Step 0: Enhance prompt (if enabled)
    if (shouldEnhance) {
      setStatus('AI is enhancing your prompt...');
      previewStatus.textContent = 'Enhancing prompt';

      const enhanceRes = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          attached_data: attachedData,
          enhancer_model: models.planner
        })
      });

      const enhanceData = await enhanceRes.json();
      if (!enhanceRes.ok) {
        console.warn('Enhancement failed, using original prompt');
      } else {
        prompt = enhanceData.enhanced_prompt || prompt;
        latestPromptText = prompt;
        showToast('Prompt enhanced!');
      }
    } else if (attachedData) {
      // If not enhancing but has attached data, append it to prompt
      prompt = `${prompt}\n\nAttached data:\n${attachedData}`;
      latestPromptText = prompt;
    }

    // Step 1: Planning
    setStatus('AI Assistant is analyzing your request...');
    setProgressStep('plan');
    previewStatus.textContent = 'Planning your app';

    const planRes = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, planner_model: models.planner })
    });

    const planData = await planRes.json();
    if (!planRes.ok) throw new Error(planData.error || 'Planning failed');

    latestPlan = planData.plan;
    planOutput.textContent = JSON.stringify(planData.plan, null, 2);
    previewUrl.textContent = `app.gea-hub.internal/${planData.plan?.title?.toLowerCase().replace(/\s+/g, '-') || 'app'}`;

    // Step 2: Coding
    setStatus('AI Assistant is building your interface...');
    setProgressStep('code');
    previewStatus.textContent = 'Building interface';

    const genRes = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        plan: planData.plan,
        save: true,
        planner_model: models.planner,
        coder_model: models.coder,
        runtime_model: models.runtime
      })
    });

    const genData = await genRes.json();
    if (!genRes.ok) throw new Error(genData.error || 'Generation failed');

    latestHtml = genData.html || '';
    htmlOutput.value = latestHtml;
    previewFrame.srcdoc = latestHtml;

    // Step 3: Done
    setProgressStep('done');
    setTimeout(() => completeProgress(), 500);

    setStatus('Your app is ready!');
    previewStatus.textContent = 'App created successfully';
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    iteratePanel.classList.remove('hidden');

    showToast('App created successfully!');
    loadRuns();

  } catch (err) {
    setStatus('Creation failed - please try again');
    previewStatus.textContent = 'Error occurred';
    showToast(err.message || 'Something went wrong', true);
    resetProgress();
  } finally {
    setGenerating(false);
  }
}

// ======================================
// Iteration
// ======================================
async function iterateOnBuild() {
  const changes = iterateInput.value.trim();
  if (!changes) {
    showToast('Please describe the changes you want', true);
    return;
  }

  if (!latestPlan || !latestHtml) {
    showToast('Generate an app first', true);
    return;
  }

  const models = getSelectedModels();
  iterateBtn.disabled = true;
  iterateBtn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span> Applying...';
  setStatus('Applying your changes...');
  resetProgress();
  setProgressStep('plan');

  try {
    const res = await fetch('/api/iterate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_prompt: latestPromptText,
        plan: latestPlan,
        html: latestHtml,
        changes_prompt: changes,
        planner_model: models.planner,
        coder_model: models.coder,
        runtime_model: models.runtime
      })
    });

    setProgressStep('code');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Iteration failed');

    latestPlan = data.plan;
    latestHtml = data.html || '';
    latestPromptText = data.prompt || latestPromptText;

    planOutput.textContent = JSON.stringify(data.plan, null, 2);
    htmlOutput.value = latestHtml;
    previewFrame.srcdoc = latestHtml;

    completeProgress();
    setStatus('Changes applied!');
    iterateInput.value = '';
    showToast('Changes applied successfully!');
    loadRuns();

  } catch (err) {
    setStatus('Iteration failed');
    showToast(err.message || 'Failed to apply changes', true);
    resetProgress();
  } finally {
    iterateBtn.disabled = false;
    iterateBtn.innerHTML = '<span class="material-symbols-outlined text-lg">refresh</span> Apply Changes';
  }
}

// ======================================
// Runs / Library
// ======================================
function formatTimestamp(ts) {
  try {
    const parts = ts.split('_');
    const dateStr = parts[0];
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const time = parts[1];
    const hour = time.slice(0, 2);
    const min = time.slice(2, 4);

    const date = new Date(year, month - 1, day, hour, min);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

async function loadRuns() {
  try {
    const res = await fetch('/api/runs');
    const data = await res.json();

    if (!data.runs?.length) {
      runsList.innerHTML = `
        <div class="bg-gray-50/50 dark:bg-[#14292b]/50 p-8 rounded-[2rem] border-2 border-dashed border-gray-100 dark:border-gray-800 flex flex-col items-center justify-center text-center min-h-[200px]">
          <span class="material-symbols-outlined text-4xl text-gray-300 mb-3">folder_open</span>
          <p class="text-sm font-bold text-gray-400">No apps created yet</p>
          <p class="text-xs text-gray-400 mt-1">Create your first app above!</p>
        </div>
      `;
      return;
    }

    runsList.innerHTML = data.runs.map(run => `
      <button onclick="loadRun('${run.timestamp}')" class="bg-white dark:bg-[#14292b] p-6 rounded-[1.5rem] border border-gray-100 dark:border-gray-800 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group text-left w-full">
        <div class="size-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-white transition-all">
          <span class="material-symbols-outlined">deployed_code</span>
        </div>
        <h5 class="text-sm font-bold text-gray-900 dark:text-white truncate">${formatTimestamp(run.timestamp)}</h5>
        <p class="text-xs text-gray-500 mt-2 leading-relaxed line-clamp-2">${run.prompt_preview || 'No description'}</p>
        <div class="mt-4 flex items-center justify-between">
          <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">View App</span>
          <span class="material-symbols-outlined text-gray-200 group-hover:text-primary transition-colors">arrow_forward</span>
        </div>
      </button>
    `).join('');

  } catch (err) {
    console.error('Failed to load runs:', err);
  }
}

async function loadRun(timestamp) {
  try {
    const res = await fetch(`/api/run/${timestamp}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    promptInput.value = data.prompt || '';
    latestPromptText = data.prompt || '';
    latestPlan = data.plan;
    latestHtml = data.html || '';

    planOutput.textContent = JSON.stringify(data.plan, null, 2);
    htmlOutput.value = latestHtml;
    previewFrame.srcdoc = latestHtml;
    previewUrl.textContent = `app.gea-hub.internal/${data.plan?.title?.toLowerCase().replace(/\s+/g, '-') || 'app'}`;

    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    iteratePanel.classList.remove('hidden');
    completeProgress();

    previewStatus.textContent = 'Loaded from library';
    setStatus('App loaded from library');
    showToast('App loaded!');

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    showToast('Failed to load app', true);
  }
}

// Make loadRun available globally
window.loadRun = loadRun;

// ======================================
// Copy / Download
// ======================================
copyBtn.addEventListener('click', async () => {
  if (!latestHtml) return;
  try {
    await navigator.clipboard.writeText(latestHtml);
    showToast('HTML copied to clipboard!');
  } catch {
    showToast('Failed to copy', true);
  }
});

downloadBtn.addEventListener('click', () => {
  if (!latestHtml) return;
  const blob = new Blob([latestHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'app.html';
  a.click();
  URL.revokeObjectURL(url);
  showToast('HTML downloaded!');
});

// ======================================
// Event Listeners
// ======================================
generateBtn.addEventListener('click', generatePipeline);
iterateBtn.addEventListener('click', iterateOnBuild);
refreshRunsBtn.addEventListener('click', loadRuns);
refreshPreview.addEventListener('click', () => {
  if (latestHtml) previewFrame.srcdoc = latestHtml;
});

// File attachment handling
attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  if (!files.length) return;

  attachedFiles = [...attachedFiles, ...files];
  attachedData = '';

  for (const file of attachedFiles) {
    try {
      const content = await file.text();
      attachedData += `\n--- ${file.name} ---\n${content.slice(0, 5000)}\n`;
    } catch (err) {
      console.error('Failed to read file:', file.name);
    }
  }

  updateAttachedFilesDisplay();
  showToast(`${files.length} file(s) attached`);
  fileInput.value = '';
});

function updateAttachedFilesDisplay() {
  if (attachedFiles.length === 0) {
    attachedFilesDisplay.classList.add('hidden');
    return;
  }

  attachedFilesDisplay.classList.remove('hidden');
  attachedFilesDisplay.innerHTML = attachedFiles.map((file, i) => `
    <div class="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-sm font-medium">
      <span class="material-symbols-outlined text-sm">description</span>
      <span>${file.name}</span>
      <button onclick="removeFile(${i})" class="hover:text-red-500">
        <span class="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  `).join('');
}

function removeFile(index) {
  attachedFiles.splice(index, 1);
  // Rebuild attached data
  (async () => {
    attachedData = '';
    for (const file of attachedFiles) {
      try {
        const content = await file.text();
        attachedData += `\n--- ${file.name} ---\n${content.slice(0, 5000)}\n`;
      } catch (err) { }
    }
    updateAttachedFilesDisplay();
  })();
}

window.removeFile = removeFile;

// Keyboard shortcut: Cmd/Ctrl + Enter
promptInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    generatePipeline();
  }
});

iterateInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    iterateOnBuild();
  }
});

// Nav links
navCreate.addEventListener('click', (e) => {
  e.preventDefault();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

navLibrary.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('library').scrollIntoView({ behavior: 'smooth' });
});

// ======================================
// Initialize
// ======================================
initDarkMode();
checkHealth();
loadConfig();
loadRuns();

// Periodic health check
setInterval(checkHealth, 30000);
