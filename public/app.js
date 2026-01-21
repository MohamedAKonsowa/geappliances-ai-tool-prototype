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
const modelTier = document.getElementById('modelTier');
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
const dsstarToggle = document.getElementById('dsstarToggle');
const dsstarPanel = document.getElementById('dsstarPanel');
const dsstarIterNum = document.getElementById('dsstar-iter-num');
const dsstarPlanStatus = document.getElementById('dsstar-plan-status');
const dsstarCodeStatus = document.getElementById('dsstar-code-status');
const dsstarTestStatus = document.getElementById('dsstar-test-status');
const dsstarPlanIcon = document.getElementById('dsstar-plan-icon');
const dsstarCodeIcon = document.getElementById('dsstar-code-icon');
const dsstarTestIcon = document.getElementById('dsstar-test-icon');
const dsstarIssues = document.getElementById('dsstarIssues');
const dsstarIssueList = document.getElementById('dsstarIssueList');
const deployBtn = document.getElementById('deployBtn');
const deployModal = document.getElementById('deployModal');
const deployAppName = document.getElementById('deployAppName');
const confirmDeploy = document.getElementById('confirmDeploy');
const cancelDeploy = document.getElementById('cancelDeploy');
const deployResult = document.getElementById('deployResult');
const deployLink = document.getElementById('deployLink');
const deploymentsList = document.getElementById('deploymentsList');
const toggleAdvanced = document.getElementById('toggleAdvanced');
const advancedIcon = document.getElementById('advancedIcon');
const toggleFullscreen = document.getElementById('toggleFullscreen');
const fullscreenIcon = document.getElementById('fullscreenIcon');

// State
let latestHtml = '';
let latestPlan = null;
let latestPromptText = '';
let isGenerating = false;
let appConfig = null;
let attachedFiles = [];
let attachedData = '';
let isDSStarMode = false;
let currentRunId = null;

// ======================================
// Toast Notifications
// ======================================
function showToast(message, isError = false) {
  if (!toastContainer) {
    console.warn('Toast:', message);
    alert(message);
    return;
  }
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

    // Populate planner model dropdown
    const plannerModelSelect = document.getElementById('plannerModel');
    if (plannerModelSelect && data.available_models?.length) {
      plannerModelSelect.innerHTML = '';
      const defaultPlanner = data.models?.planner || 'llama-3.3-70b-versatile';

      data.available_models.sort().forEach(model => {
        const opt = document.createElement('option');
        opt.value = model;
        opt.textContent = model;
        if (model === defaultPlanner) opt.selected = true;
        plannerModelSelect.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function getSelectedTier() {
  return modelTier?.value || 'standard';
}

function getSelectedPlannerModel() {
  const plannerModelSelect = document.getElementById('plannerModel');
  return plannerModelSelect?.value || 'llama-3.3-70b-versatile';
}

// For backwards compatibility with non-DS-Star endpoints
function getSelectedModels() {
  const tier = getSelectedTier();
  const tierDefaults = {
    pro: 'llama-3.3-70b-versatile',
    standard: 'llama-3.3-70b-versatile',
    basic: 'llama-3.1-8b-instant'
  };
  const model = tierDefaults[tier] || tierDefaults.standard;
  return {
    planner: getSelectedPlannerModel(),
    coder: model,
    runtime: tier === 'pro' ? 'llama-3.1-8b-instant' : 'llama-3.1-8b-instant'
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
    if (!icon || !title || !desc) return;

    // If this is the target step and status is 'complete', mark it complete
    if (step === activeStep && status === 'complete') {
      icon.className = 'size-7 rounded-full bg-green-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-green-200';
      icon.innerHTML = '<span class="material-symbols-outlined text-lg">check</span>';
      title.className = 'text-[15px] font-bold text-gray-900 dark:text-white leading-none';
      desc.textContent = 'Completed';
    } else if (step === activeStep && status === 'error') {
      icon.className = 'size-7 rounded-full bg-red-500 text-white flex items-center justify-center shrink-0';
      icon.innerHTML = '<span class="material-symbols-outlined text-lg">close</span>';
      title.className = 'text-[15px] font-bold text-red-600 leading-none';
      desc.textContent = 'Failed';
    } else if (i < stepIndex) {
      // Completed previous steps
      icon.className = 'size-7 rounded-full bg-green-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-green-200';
      icon.innerHTML = '<span class="material-symbols-outlined text-lg">check</span>';
      title.className = 'text-[15px] font-bold text-gray-900 dark:text-white leading-none';
      desc.textContent = 'Completed';
    } else if (i === stepIndex && status === 'active') {
      // Active
      icon.className = 'size-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0';
      icon.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">progress_activity</span>';
      title.className = 'text-[15px] font-bold text-primary leading-none';
      desc.textContent = step === 'plan' ? 'Analyzing requirements...' : step === 'code' ? 'Generating code...' : 'Finalizing...';
    } else if (i > stepIndex || (i === stepIndex && status !== 'complete' && status !== 'error' && status !== 'active')) {
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
  // Check if DS-Star mode is enabled
  if (isDSStarMode) {
    return generateDSStarPipeline();
  }

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

    // Enable deployment
    const runId = genData.runId || genData.timestamp;
    if (runId) {
      currentRunId = runId;
      deployBtn.disabled = false;
    }

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
    // 1. Load regular runs
    const res = await fetch('/api/runs');
    const data = await res.json();

    if (!data.runs || !data.runs.length) {
      runsList.innerHTML = `
        <div class="col-span-full bg-gray-50/50 dark:bg-[#14292b]/50 p-8 rounded-[2rem] border-2 border-dashed border-gray-100 dark:border-gray-800 flex flex-col items-center justify-center text-center min-h-[200px]">
          <span class="material-symbols-outlined text-4xl text-gray-300 mb-3">folder_open</span>
          <p class="text-sm font-bold text-gray-400">No tools generated yet</p>
        </div>
      `;
    } else {
      runsList.innerHTML = data.runs.map(run => `
        <button onclick="loadRun('${run.timestamp}')" class="bg-white dark:bg-[#14292b] p-6 rounded-[1.5rem] border border-gray-100 dark:border-gray-800 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group text-left w-full">
          <div class="size-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-white transition-all">
            <span class="material-symbols-outlined">history</span>
          </div>
          <h5 class="text-sm font-bold text-gray-900 dark:text-white truncate">${formatTimestamp(run.timestamp)}</h5>
          <p class="text-xs text-gray-500 mt-2 leading-relaxed line-clamp-2">${run.prompt_preview || 'No description'}</p>
          <div class="mt-4 flex items-center justify-between">
            <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Edit & Iterate</span>
            <span class="material-symbols-outlined text-gray-200 group-hover:text-primary transition-colors">edit_note</span>
          </div>
        </button>
      `).join('');
    }

    // 2. Load deployments
    const dRes = await fetch('/api/deployments');
    const dData = await dRes.json();
    if (deploymentsList) {
      if (!dData.deployments || !dData.deployments.length) {
        deploymentsList.innerHTML = `
          <div class="col-span-full bg-amber-50/20 p-8 rounded-[2rem] border-2 border-dashed border-amber-100 flex flex-col items-center justify-center text-center min-h-[150px]">
            <p class="text-sm font-bold text-amber-600/50">No apps deployed yet</p>
          </div>
        `;
      } else {
        deploymentsList.innerHTML = dData.deployments.map(deploy => `
          <div class="bg-white dark:bg-[#14292b] p-6 rounded-[1.5rem] border border-amber-100 dark:border-amber-900/30 hover:shadow-xl transition-all group relative overflow-hidden">
            <div class="absolute top-0 right-0 p-3">
               <span class="px-2 py-1 bg-amber-100 text-amber-700 text-[9px] font-black uppercase rounded-lg">Live</span>
            </div>
            <div class="size-10 bg-amber-500 text-white rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-amber-500/20">
              <span class="material-symbols-outlined">rocket_launch</span>
            </div>
            <h5 class="text-sm font-bold text-gray-900 dark:text-white truncate">${deploy.appName}</h5>
            <p class="text-[10px] text-gray-400 mt-1 font-mono">${deploy.slug}</p>
            <div class="mt-6 flex flex-col gap-2">
              <a href="${deploy.url}" target="_blank" class="flex items-center justify-center gap-2 w-full py-2.5 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary-warm transition-all decoration-none">
                <span class="material-symbols-outlined text-sm">open_in_new</span> Open Published App
              </a>
              <button onclick="loadRun('${deploy.slug}')" class="flex items-center justify-center gap-2 w-full py-2.5 bg-gray-50 dark:bg-gray-800 text-gray-500 text-xs font-bold rounded-xl hover:bg-gray-100 transition-all">
                <span class="material-symbols-outlined text-sm">edit</span> Edit Original
              </button>
            </div>
          </div>
        `).join('');
      }
    }

  } catch (err) {
    console.error('Failed to load library:', err);
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
    deployBtn.disabled = false;
    currentRunId = timestamp;
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

// Model Config Toggle
if (toggleAdvanced && advancedPanel) {
  toggleAdvanced.addEventListener('click', () => {
    const isHidden = advancedPanel.classList.toggle('hidden');
    advancedIcon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
  });
}

// Fullscreen Toggle
if (toggleFullscreen && previewContainer) {
  toggleFullscreen.addEventListener('click', () => {
    const isFullscreen = previewContainer.classList.toggle('fullscreen-preview');
    fullscreenIcon.textContent = isFullscreen ? 'fullscreen_exit' : 'fullscreen';

    // Smooth scroll to preview if exiting
    if (!isFullscreen) {
      previewContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

// ======================================
// DS-Star Mode
// ======================================
if (dsstarToggle) {
  dsstarToggle.addEventListener('change', () => {
    isDSStarMode = dsstarToggle.checked;
    if (dsstarPanel) {
      dsstarPanel.classList.toggle('hidden', !isDSStarMode);
    }
    if (isDSStarMode) {
      showToast('DS-Star mode enabled - iterative improvement with critics & tests');
    }
  });
}

function updateDSStarStatus(status) {
  if (dsstarIterNum) dsstarIterNum.textContent = status.iteration || '-';

  const updateField = (icon, text, value, approved) => {
    if (icon && text) {
      if (approved === true) {
        icon.textContent = 'check_circle';
        icon.className = 'material-symbols-outlined text-green-500';
        text.textContent = 'Approved';
        text.className = 'font-medium text-green-600';
      } else if (approved === false) {
        icon.textContent = 'error';
        icon.className = 'material-symbols-outlined text-red-500';
        text.textContent = value || 'Rejected';
        text.className = 'font-medium text-red-600';
      } else if (value === 'working') {
        icon.textContent = 'sync';
        icon.className = 'material-symbols-outlined text-amber-500 animate-spin';
        text.textContent = 'Working...';
        text.className = 'font-medium text-amber-600';
      } else {
        icon.textContent = 'hourglass_empty';
        icon.className = 'material-symbols-outlined text-gray-400';
        text.textContent = 'Pending';
        text.className = 'font-medium text-gray-500';
      }
    }
  };

  updateField(dsstarPlanIcon, dsstarPlanStatus, status.plan, status.planApproved);
  updateField(dsstarCodeIcon, dsstarCodeStatus, status.code, status.codeApproved);
  updateField(dsstarTestIcon, dsstarTestStatus, status.test, status.testsApproved);

  // Show issues if any
  if (status.issues && status.issues.length > 0 && dsstarIssues && dsstarIssueList) {
    dsstarIssues.classList.remove('hidden');
    dsstarIssueList.innerHTML = status.issues.map(i =>
      `<li>• ${i.message || i}</li>`
    ).join('');
  } else if (dsstarIssues) {
    dsstarIssues.classList.add('hidden');
  }

  // Show models if provided
  if (status.models) {
    const modelsPanel = document.getElementById('dsstarModels');
    const modelCoder = document.getElementById('model-coder');
    const modelCritic = document.getElementById('model-critic');
    const modelRuntime = document.getElementById('model-runtime');
    if (modelsPanel) modelsPanel.classList.remove('hidden');
    if (modelCoder) modelCoder.textContent = status.models.coder || '-';
    if (modelCritic) modelCritic.textContent = status.models.critic || '-';
    if (modelRuntime) modelRuntime.textContent = status.models.runtime || '-';
  }
}


async function generateDSStarPipeline() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    showToast('Please enter a prompt', true);
    return;
  }

  setGenerating(true);
  setStatus('Starting DS-Star pipeline...');
  setProgressStep('plan', 'active');

  // Show DS-Star panel
  if (dsstarPanel) dsstarPanel.classList.remove('hidden');
  updateDSStarStatus({ iteration: 1, plan: 'working' });

  // Build SSE URL with query params
  const params = new URLSearchParams({
    prompt,
    maxIters: 8,
    tier: getSelectedTier(),
    plannerModel: getSelectedPlannerModel()
  });


  return new Promise((resolve) => {
    const eventSource = new EventSource(`/api/pipeline-dsstar-stream?${params}`);
    let finalData = null;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[DS-Star SSE]', data);

        if (data.type === 'start') {
          setStatus(`DS-Star started: ${data.runId}`);
          currentRunId = data.runId;
        } else if (data.type === 'iteration') {
          // Update iteration display
          if (dsstarIterNum) dsstarIterNum.textContent = data.iteration;
          setStatus(`Iteration ${data.iteration}/${data.maxIters}: ${data.phase}`);

          // Update phase-specific status
          if (data.phase === 'plan' || data.phase === 'plan_critique') {
            if (data.status === 'working') {
              updateDSStarStatus({ iteration: data.iteration, plan: 'working' });
              setProgressStep('plan', 'active');
            } else if (data.status === 'approved') {
              updateDSStarStatus({ iteration: data.iteration, planApproved: true, models: data.models });
              setProgressStep('plan', 'complete');

            } else if (data.status === 'rejected' || data.status === 'failed') {
              updateDSStarStatus({ iteration: data.iteration, planApproved: false, issues: data.issues });
            }
          } else if (data.phase === 'code' || data.phase === 'code_critique' || data.phase === 'codegen') {
            if (data.status === 'working') {
              updateDSStarStatus({ iteration: data.iteration, planApproved: true, code: 'working' });
              setProgressStep('code', 'active');
            } else if (data.status === 'approved') {
              updateDSStarStatus({ iteration: data.iteration, planApproved: true, codeApproved: true });
              setProgressStep('code', 'complete');
            } else if (data.status === 'rejected' || data.status === 'failed' || data.status === 'security_failed') {
              updateDSStarStatus({ iteration: data.iteration, planApproved: true, codeApproved: false, issues: data.issues || [{ message: data.error }] });
            }
          } else if (data.phase === 'tests') {
            if (data.status === 'working') {
              updateDSStarStatus({ iteration: data.iteration, planApproved: true, codeApproved: true, test: 'working' });
              setProgressStep('done', 'active');
            } else if (data.status === 'passed' || data.status === 'skipped_passed') {
              updateDSStarStatus({ iteration: data.iteration, planApproved: true, codeApproved: true, testsApproved: true });
              setProgressStep('done', 'complete');
            } else if (data.status === 'failed') {
              updateDSStarStatus({ iteration: data.iteration, planApproved: true, codeApproved: true, testsApproved: false, issues: data.errors?.map(e => ({ message: e })) });
            }
          }
        } else if (data.type === 'success') {
          setStatus('DS-Star complete!');
          setProgressStep('done', 'complete');
          showToast('✅ DS-Star pipeline succeeded!');
        } else if (data.type === 'complete') {
          finalData = data;
          eventSource.close();
          handleDSStarComplete(data).catch(e => {
            console.error('Finalization error:', e);
            setGenerating(false);
          });
          resolve(data);
        } else if (data.type === 'error' || data.type === 'stopped') {
          setStatus('DS-Star failed: ' + (data.error || data.reason));
          showToast(data.error || data.reason, true);
          eventSource.close();
          setGenerating(false);
          resolve(null);
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE error:', err);
      eventSource.close();
      if (!finalData) {
        setStatus('Connection lost - check server logs');
        showToast('DS-Star connection lost', true);
        setGenerating(false);
      }
      resolve(null);
    };
  });
}

async function handleDSStarComplete(data) {
  try {
    // Update final status
    updateDSStarStatus({
      iteration: data.summary?.totalIterations || 1,
      planApproved: data.summary?.planApprovedAt != null,
      codeApproved: data.summary?.codeApprovedAt != null,
      testsApproved: data.summary?.testsPassedAt != null
    });

    if (data.finalPlan) {
      latestPlan = data.finalPlan;
      if (planOutput) planOutput.textContent = JSON.stringify(data.finalPlan, null, 2);
      setProgressStep('plan', 'complete');
    }

    // Load the final HTML if available
    if (data.finalHtmlPath) {
      try {
        const htmlRes = await fetch(data.finalHtmlPath);
        if (htmlRes.ok) {
          latestHtml = await htmlRes.text();
          if (htmlOutput) htmlOutput.textContent = latestHtml.slice(0, 5000) + (latestHtml.length > 5000 ? '...' : '');
          if (previewFrame) previewFrame.srcdoc = latestHtml;
          if (previewUrl) {
            previewUrl.textContent = data.finalHtmlPath;
            previewUrl.href = data.finalHtmlPath;
          }
          setProgressStep('code', 'complete');
          setProgressStep('done', 'complete');
        }
      } catch (e) {
        console.error('Failed to load final HTML:', e);
      }
    }

    // Show failure report if not successful
    if (!data.success && data.failureReports?.length > 0) {
      console.log('Failure reports:', data.failureReports);
      const lastFail = data.failureReports[data.failureReports.length - 1];
      updateDSStarStatus({
        iteration: data.summary?.totalIterations || 1,
        planApproved: data.summary?.planApprovedAt != null,
        codeApproved: data.summary?.codeApprovedAt != null,
        testsApproved: data.summary?.testsPassedAt != null,
        issues: lastFail.issues || lastFail.consoleErrors?.map(e => ({ message: e })) || [{ message: lastFail.error || 'Unknown error' }]
      });
    }

    latestPromptText = promptInput.value.trim();
    if (iteratePanel) iteratePanel.classList.remove('hidden');

    setStatus(data.success ? 'DS-Star complete!' : `DS-Star finished after ${data.summary?.totalIterations} iterations`);
    showToast(data.success ? '✅ DS-Star pipeline succeeded!' : '⚠️ DS-Star completed with issues - see failure report');

    loadRuns();

    // Enable deployment
    if (currentRunId) {
      deployBtn.disabled = false;
    }
  } catch (e) {
    console.error('Error in handleDSStarComplete:', e);
  } finally {
    setGenerating(false);
  }
}

// ======================================
// Deployment Logic
// ======================================
deployBtn.addEventListener('click', () => {
  if (!currentRunId) return;

  // Pre-fill app name from plan title
  if (latestPlan && latestPlan.title) {
    deployAppName.value = latestPlan.title;
  } else {
    deployAppName.value = '';
  }

  deployModal.classList.remove('hidden');
  deployResult.classList.add('hidden');
  confirmDeploy.disabled = false;
  confirmDeploy.textContent = 'Confirm Deployment';
});

cancelDeploy.addEventListener('click', () => {
  deployModal.classList.add('hidden');
});

confirmDeploy.addEventListener('click', async () => {
  const appName = deployAppName.value.trim();
  if (!appName) {
    showToast('Please enter an app name', true);
    return;
  }

  confirmDeploy.disabled = true;
  confirmDeploy.textContent = 'Deploying...';

  try {
    const res = await fetch(`/api/deploy/${currentRunId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Deployment failed');

    deployResult.classList.remove('hidden');
    deployLink.href = data.url;
    deployLink.textContent = window.location.origin + data.url;

    showToast('App deployed successfully!');
    confirmDeploy.textContent = 'Deployed ✅';

    // Switch preview to deployed URL
    previewUrl.textContent = `app.gea-hub.internal/${data.slug}`;

  } catch (err) {
    confirmDeploy.disabled = false;
    confirmDeploy.textContent = 'Confirm Deployment';
    showToast(err.message || 'Failed to deploy app', true);
  }
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
