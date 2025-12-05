import { CreateMLCEngine } from 'https://esm.run/@mlc-ai/web-llm';

// --- CONFIGURATION ---
// Models are now selected via UI in index.html

// --- GLOBAL STATE ---
let engine = null;
let isModelLoaded = false;
let sessions = [];
let currentSession = null;
let currentSessionId = null;
let isGenerating = false;
let currentController = null; // WebLLM doesn't support AbortController the same way yet, but we can try interrupt
let isThinkingMode = false; // Default off
let isResearchMode = false; // Disabled for mobile

// Stats
let systemStats = {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  lastSpeed: 0,
};

// Default Personas - REMOVED

// --- DOM ELEMENTS ---
const messagesContainer = document.getElementById('messages');
const input = document.getElementById('question');
const sessionList = document.getElementById('session-list');
const btnSubmit = document.getElementById('btn-submit');

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
  // Setup UI Events
  setupEventListeners();

  // Load Data
  await loadSessions();
  loadStats();

  // Setup Model Loader
  const btnStart = document.getElementById('btn-start-engine');
  if (btnStart) {
    btnStart.addEventListener('click', startEngine);
  }
});

async function startEngine() {
  const btnStart = document.getElementById('btn-start-engine');
  const statusMain = document.getElementById('model-status-main');
  const statusDetail = document.getElementById('model-status-detail');
  const loadingBar = document.getElementById('model-loading-bar');
  const modelSelect = document.getElementById('model-select');
  const selectedModel = modelSelect ? modelSelect.value : 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

  btnStart.style.display = 'none';
  if (modelSelect) modelSelect.disabled = true; // Lock selection
  statusMain.textContent = 'Initializing WebGPU...';

  try {
    engine = await CreateMLCEngine(selectedModel, {
      initProgressCallback: (report) => {
        console.log(report);

        // Update Bar
        if (report.progress) {
          loadingBar.style.width = `${report.progress * 100}%`;
        }

        // Format Text nicely
        if (report.text.includes('Fetching param cache')) {
          const percent = report.progress ? Math.round(report.progress * 100) : 0;
          statusMain.textContent = `Downloading Model... ${percent}%`;
          statusDetail.textContent = report.text; // Technical details smaller
        } else if (report.text.includes('Loading model from cache')) {
          statusMain.textContent = 'Loading from Cache...';
          statusDetail.textContent = 'Verifying files...';
        } else if (report.text.includes('Finish loading')) {
          statusMain.textContent = 'Ready!';
          statusDetail.textContent = '';
        } else {
          // Fallback for other states
          statusMain.textContent = report.text;
          statusDetail.textContent = '';
        }
      },
    });

    isModelLoaded = true;
    document.getElementById('model-loading-overlay').style.display = 'none';

    // Create new session if none exists
    if (sessions.length === 0) {
      createNewSession();
    } else {
      // Load last session
      switchSession(sessions[0].id);
    }
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Error: ' + err.message;
    loadingText.style.color = 'red';
    btnStart.style.display = 'block';
    btnStart.textContent = 'Retry';
  }
}

function setupEventListeners() {
  // Input
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleInput();
    }
  });

  btnSubmit.addEventListener('click', handleInput);

  // Mode Toggles
  document.getElementById('btn-mode-thinking').addEventListener('click', (e) => {
    isThinkingMode = !isThinkingMode;
    e.target.classList.toggle('active', isThinkingMode);
    updatePlaceholder();
  });

  // Research Mode Toggle
  document.getElementById('btn-mode-research').addEventListener('click', (e) => {
    isResearchMode = !isResearchMode;
    e.target.classList.toggle('active', isResearchMode);
    // Visual feedback only, logic handled in askSingleModel
  });

  // New Session
  document.getElementById('btn-new-session').addEventListener('click', () => {
    createNewSession();
    // Close sidebar on mobile after creating new session
    document.querySelector('.sidebar-left').classList.remove('show');
    document.querySelector('.sidebar-backdrop').classList.remove('show');
  });

  // Mobile Sidebar Toggles
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  document.body.appendChild(backdrop);

  const toggleLeft = document.getElementById('btn-toggle-left');
  const toggleRight = document.getElementById('btn-toggle-right');
  const sidebarLeft = document.querySelector('.sidebar-left');
  const sidebarRight = document.querySelector('.sidebar-right');

  if (toggleLeft) {
    toggleLeft.addEventListener('click', () => {
      sidebarLeft.classList.toggle('show');
      sidebarRight.classList.remove('show'); // Close other
      backdrop.classList.toggle('show', sidebarLeft.classList.contains('show'));
    });
  }

  if (toggleRight) {
    toggleRight.addEventListener('click', () => {
      sidebarRight.classList.toggle('show');
      sidebarLeft.classList.remove('show'); // Close other
      backdrop.classList.toggle('show', sidebarRight.classList.contains('show'));
    });
  }

  backdrop.addEventListener('click', () => {
    sidebarLeft.classList.remove('show');
    sidebarRight.classList.remove('show');
    backdrop.classList.remove('show');
  });
}

function updatePlaceholder() {
  if (isResearchMode) {
    input.placeholder = 'Enter research topic...';
  } else {
    input.placeholder = 'Send a message...';
  }
}

// --- CHAT LOGIC ---

async function handleInput() {
  if (isGenerating || !input.value.trim()) return;

  const q = input.value.trim();
  input.value = '';

  if (!currentSession) createNewSession();

  // Add User Message
  addMessageToUI(q, 'user');
  currentSession.messages.push({ role: 'user', content: q });
  saveSessions();

  isGenerating = true;
  btnSubmit.innerHTML = '<i class="fas fa-stop"></i>';

  try {
    await askSingleModel(q);
  } catch (e) {
    console.error(e);
    addMessageToUI('Error: ' + e.message, 'system');
  } finally {
    isGenerating = false;
    btnSubmit.innerHTML = '<i class="fas fa-paper-plane"></i>';

    // Generate Title if needed
    if (currentSession.messages.length >= 2 && currentSession.title === 'New Chat') {
      generateTitle(q);
    }
  }
}

async function askSingleModel(q) {
  // Create Placeholder
  const responseDiv = addMessageToUI('', 'assistant');
  const contentDiv = responseDiv.querySelector('.msg-content');
  const headerDiv = responseDiv.querySelector('.msg-header');

  // Add Timer Element
  const timerSpan = document.createElement('span');
  timerSpan.className = 'response-timer';
  timerSpan.style.float = 'right';
  timerSpan.style.color = '#00ff00';
  timerSpan.textContent = '0.0s';
  headerDiv.appendChild(timerSpan);

  const startTime = Date.now();
  const timerInterval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    timerSpan.textContent = `${elapsed}s`;
  }, 100);

  if (isResearchMode) {
    contentDiv.innerHTML = '<i class="fas fa-book-reader fa-spin"></i> Researching...';
  } else {
    contentDiv.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Thinking...';
  }

  let fullText = '';
  let systemPrompt =
    'You are a helpful, intelligent AI assistant. You always provide clear, complete, and direct answers. You do not output truncated text or "read more" links.';

  if (isResearchMode) {
    systemPrompt =
      'You are an advanced Research Engine. Your goal is to provide a deeply researched, academic-quality answer.\n\n' +
      'CRITICAL INSTRUCTION: You MUST use the XML tag <think> for your research process.\n' +
      'Example format:\n' +
      '<think>\n' +
      'Research Objectives:\n' +
      '- Objective 1...\n' +
      'Research Steps:\n' +
      '1. Step 1...\n' +
      '</think>\n' +
      '# Final Answer Title\n' +
      'Here is the detailed report...';
  }

  if (isThinkingMode && !isResearchMode) {
    systemPrompt +=
      ' IMPORTANT: You are a deep thinking AI. You MUST start your response with a <think>...</think> block where you reason about the user query step-by-step before providing the final answer. Example: <think>My thought process...</think> Final Answer...';
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...currentSession.messages.slice(-10), // Context window limit for mobile
  ];

  try {
    const completion = await engine.chat.completions.create({
      messages: messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.7,
      max_tokens: 4000, // Ensure enough tokens for research
    });

    let finalUsage = null;

    for await (const chunk of completion) {
      if (chunk.choices && chunk.choices.length > 0) {
        const delta = chunk.choices[0].delta.content;
        if (delta) {
          fullText += delta;
          updateStreamingContent(contentDiv, fullText);
          scrollToBottom();
        }
      }
      if (chunk.usage) {
        finalUsage = chunk.usage;
      }
    }

    // Save
    currentSession.messages.push({ role: 'assistant', content: fullText });
    saveSessions();

    // Track Usage
    if (finalUsage) {
      trackUsage(finalUsage, Date.now() - startTime);
    }
  } catch (e) {
    contentDiv.innerHTML += `<br><span style="color:red">[Error: ${e.message}]</span>`;
  } finally {
    clearInterval(timerInterval);
    // Ensure final time is set
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    timerSpan.textContent = `${elapsed}s`;
  }
}

async function generateTitle(firstUserMsg) {
  try {
    const completion = await engine.chat.completions.create({
      messages: [
        {
          role: 'system',
          content:
            'Generate a very short title (max 4 words) for this chat. Output ONLY the title.',
        },
        { role: 'user', content: firstUserMsg },
      ],
      max_tokens: 50,
    });

    let title = completion.choices[0].message.content.trim().replace(/["']/g, '');
    currentSession.title = title;
    saveSessions();
    renderSessionList();
    document.querySelector('.header-title').textContent = `Session: ${title}`;
  } catch (e) {
    console.warn('Title generation failed', e);
  }
}

// --- UI HELPERS ---

function addMessageToUI(text, role) {
  // Remove system message if it exists (e.g. "Session Loaded")
  const sysMsg = messagesContainer.querySelector('.system-message');
  if (sysMsg) {
    sysMsg.remove();
  }

  const div = document.createElement('div');
  if (role === 'user') {
    div.className = 'msg-card msg-user';
    div.innerHTML = `
      <div class="msg-header">USER</div>
      <div class="msg-content">${renderMarkdown(text)}</div>
    `;
  } else {
    div.className = 'msg-card'; // Generic assistant
    div.innerHTML = `
      <div class="msg-header">ASSISTANT</div>
      <div class="msg-content">${renderMarkdown(text)}</div>
    `;
  }
  messagesContainer.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// --- MARKDOWN & THINKING ---
// (Simplified version of original)
function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text);
  }
  return text;
}

function updateStreamingContent(container, text) {
  // Normalize thinking tags to handle variations like "think:" or "Thinking:"
  let normalizedText = text;
  let startTag = '<think>';
  let endTag = '</think>';

  // Fallback: If no standard tag is found, check for common model hallucinations
  if (!text.includes(startTag)) {
    const lower = text.trim().toLowerCase();
    if (lower.startsWith('think:')) startTag = 'think:';
    else if (lower.startsWith('thinking:')) startTag = 'thinking:';
    else if (lower.startsWith('**thought process:**')) startTag = '**Thought Process:**';
    else if (lower.startsWith('research objectives:')) startTag = 'Research Objectives:'; // Catch the specific case from screenshot
  }

  const startIndex = normalizedText.indexOf(startTag);

  if (startIndex !== -1) {
    let box = container.querySelector('.thinking-box');
    if (!box) {
      // Clear loader or partial text if present
      container.innerHTML = '';

      box = document.createElement('div');
      box.className = 'thinking-box';
      box.innerHTML = `
        <div class="thinking-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span><i class="fas fa-brain"></i> Thought Process</span>
          <i class="fas fa-chevron-down toggle-icon"></i>
        </div>
        <div class="thinking-content"></div>
      `;
      container.appendChild(box);

      // Answer container
      const ans = document.createElement('div');
      ans.className = 'answer-content';
      container.appendChild(ans);
    }

    let thinkingPart = '';
    let answerPart = '';
    const endIndex = normalizedText.indexOf(endTag, startIndex);

    if (endIndex !== -1) {
      thinkingPart = normalizedText.substring(startIndex + startTag.length, endIndex);
      answerPart = normalizedText.substring(endIndex + endTag.length);

      // Auto collapse if done
      if (!box.classList.contains('collapsed') && !box.dataset.userOpened) {
        box.classList.add('collapsed');
      }
    } else {
      thinkingPart = normalizedText.substring(startIndex + startTag.length);
      answerPart = ''; // Still thinking
    }

    box.querySelector('.thinking-content').innerHTML = renderMarkdown(thinkingPart);
    if (container.querySelector('.answer-content')) {
      container.querySelector('.answer-content').innerHTML = renderMarkdown(answerPart);
    }
  } else {
    // No thinking tags found
    if (container.innerHTML.includes('fa-spin')) container.innerHTML = '';
    container.innerHTML = renderMarkdown(text);
  }
}

// --- SESSION MANAGEMENT ---

async function loadSessions() {
  const data = localStorage.getItem('colossus_mobile_sessions');
  if (data) {
    sessions = JSON.parse(data);
  }
  renderSessionList();
}

function saveSessions() {
  localStorage.setItem('colossus_mobile_sessions', JSON.stringify(sessions));
  renderSessionList();
}

function createNewSession() {
  const id = Date.now().toString();
  const newSession = {
    id: id,
    title: 'New Chat',
    messages: [],
    timestamp: Date.now(),
  };
  sessions.unshift(newSession);
  switchSession(id);
}

function switchSession(id) {
  currentSessionId = id;
  currentSession = sessions.find((s) => s.id === id);
  saveSessions(); // Update order/timestamp if needed

  // Render Messages
  messagesContainer.innerHTML = '<div class="system-message">Session Loaded.</div>';

  currentSession.messages.forEach((msg) => {
    addMessageToUI(msg.content, msg.role);
  });

  document.querySelector('.header-title').textContent = `Session: ${currentSession.title}`;

  // Highlight in sidebar
  renderSessionList();
}

function renderSessionList() {
  sessionList.innerHTML = '';
  sessions.forEach((s) => {
    const div = document.createElement('div');
    div.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
    div.innerHTML = `
      <div class="session-info">
        <div class="session-name-text">${s.title}</div>
        <div class="session-meta">${new Date(s.timestamp).toLocaleTimeString()}</div>
      </div>
      <div class="session-actions">
        <button class="action-icon btn-delete"><i class="fas fa-trash"></i></button>
      </div>
    `;
    div.addEventListener('click', () => switchSession(s.id));
    div.querySelector('.btn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });
    sessionList.appendChild(div);
  });
}

function deleteSession(id) {
  sessions = sessions.filter((s) => s.id !== id);
  saveSessions();
  if (currentSessionId === id) {
    if (sessions.length > 0) switchSession(sessions[0].id);
    else {
      messagesContainer.innerHTML = '';
      currentSession = null;
    }
  }
}

// --- STATS MANAGEMENT ---
function loadStats() {
  const stored = localStorage.getItem('colossus_mobile_stats');
  if (stored) {
    systemStats = JSON.parse(stored);
  }
  updateStatsUI();
}

function saveStats() {
  localStorage.setItem('colossus_mobile_stats', JSON.stringify(systemStats));
  updateStatsUI();
}

function updateStatsUI() {
  const statRequests = document.getElementById('stat-requests');
  const statPrompt = document.getElementById('stat-prompt');
  const statCompletion = document.getElementById('stat-completion');
  const statSpeed = document.getElementById('stat-speed');

  const barRequests = document.getElementById('bar-requests');
  const barPrompt = document.getElementById('bar-prompt');
  const barCompletion = document.getElementById('bar-completion');
  const barSpeed = document.getElementById('bar-speed');

  if (statRequests) statRequests.textContent = systemStats.requests;
  if (statPrompt) statPrompt.textContent = systemStats.promptTokens.toLocaleString();
  if (statCompletion) statCompletion.textContent = systemStats.completionTokens.toLocaleString();
  if (statSpeed) statSpeed.textContent = systemStats.lastSpeed.toFixed(1) + ' T/s';

  // Visual bars (cycling 0-100%)
  if (barRequests) barRequests.style.width = (systemStats.requests % 100) + '%';
  if (barPrompt) barPrompt.style.width = ((systemStats.promptTokens / 100) % 100) + '%';
  if (barCompletion) barCompletion.style.width = ((systemStats.completionTokens / 100) % 100) + '%';

  if (barSpeed) {
    let speedPercent = (systemStats.lastSpeed / 100) * 100;
    if (speedPercent > 100) speedPercent = 100;
    barSpeed.style.width = speedPercent + '%';
  }
}

function trackUsage(usage, timeMs) {
  if (!usage) return;

  systemStats.requests++;
  systemStats.promptTokens += usage.prompt_tokens || 0;
  systemStats.completionTokens += usage.completion_tokens || 0;

  if (usage.completion_tokens > 0 && timeMs > 0) {
    const seconds = timeMs / 1000;
    systemStats.lastSpeed = usage.completion_tokens / seconds;
  }

  saveStats();
}
