// --- GLOBAL STATE ---
let sessions = [];
let currentSessionId = null;
let systemStats = {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  lastSpeed: 0,
};

// --- STORAGE MANAGEMENT (LocalStorage Only) ---

async function initializeApp() {
  // Try to migrate data from static files if LocalStorage is empty
  await migrateStaticData();

  // Load Data
  await loadStats();
  await loadPersonas();
  await loadSavedModels();
  await loadSessions();
  fetchLoadedModels(); // Check LM Studio
}

async function migrateStaticData() {
  // Helper to fetch and save if missing
  const migrate = async (key, path) => {
    if (!localStorage.getItem(key)) {
      try {
        const res = await fetch(path);
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem(key, JSON.stringify(data));
          console.log(`Migrated ${path} to ${key}`);
        }
      } catch (e) {
        console.warn(`Could not migrate ${path}:`, e);
      }
    }
  };

  await migrate('colossus_data_personas.json', 'data/personas.json');
  await migrate('colossus_data_models.json', 'data/models.json');
  // We cannot migrate conversations automatically as we can't list the directory via fetch
}

// Storage Helpers
async function fsReadFile(subDir, filename) {
  const key = `colossus_${subDir}_${filename}`;
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : null;
}

async function fsWriteFile(subDir, filename, data) {
  const key = `colossus_${subDir}_${filename}`;
  localStorage.setItem(key, JSON.stringify(data));
}

async function fsDeleteFile(subDir, filename) {
  const key = `colossus_${subDir}_${filename}`;
  localStorage.removeItem(key);
}

async function fsListFiles(subDir) {
  const prefix = `colossus_${subDir}_`;
  const files = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(prefix)) {
      files.push(key.replace(prefix, ''));
    }
  }
  return files;
}

// --- MARKDOWN SETUP ---
// Configure Marked.js with Highlight.js and Custom Code Blocks
if (typeof marked !== 'undefined') {
  const renderer = new marked.Renderer();
  renderer.code = function (code, language) {
    const validLang = !!(language && hljs.getLanguage(language));
    const highlighted = validLang
      ? hljs.highlight(code, { language }).value
      : hljs.highlightAuto(code).value;

    const langDisplay = (language || 'code').toUpperCase();
    // Escape code for the hidden div
    const rawCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    return `
      <div class="code-block-wrapper">
        <div class="code-header">
          <span>${langDisplay}</span>
          <button class="copy-btn" onclick="copyToClipboard(this)">
            <i class="fas fa-copy"></i> Copy
          </button>
        </div>
        <pre><code class="hljs ${language}">${highlighted}</code></pre>
        <div style="display:none" class="raw-code">${rawCode}</div>
      </div>
    `;
  };
  marked.use({ renderer });
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined') return text;

  // Ensure text is a string to prevent "e.replace is not a function" errors
  const safeText = String(text || '');

  try {
    return `<div class="markdown-body">${marked.parse(safeText)}</div>`;
  } catch (e) {
    console.error('Markdown parsing error:', e);
    // Fallback to plain text if parsing fails
    return `<div class="markdown-body">${safeText}</div>`;
  }
}

function updateStreamingContent(container, text) {
  const startTag = '<think>';
  const endTag = '</think>';
  const startIndex = text.indexOf(startTag);

  if (startIndex !== -1) {
    // Has thinking block
    let thinkingPart = '';
    let answerPart = '';
    const endIndex = text.indexOf(endTag, startIndex);

    // 1. Handle Thinking Box
    let box = container.querySelector('.thinking-box');
    if (!box) {
      // First time seeing thinking tags? Clear placeholder (loader)
      // But be careful not to clear if we are just appending.
      // If we don't have a box, and we don't have an answer container, assume it's fresh or placeholder.
      if (!container.querySelector('.answer-content')) {
        container.innerHTML = '';
      }

      // Create if missing
      box = document.createElement('div');
      box.className = 'thinking-box'; // Default expanded
      box.innerHTML = `
        <div class="thinking-header">
          <span><i class="fas fa-brain"></i> Thought Process</span>
          <i class="fas fa-chevron-down toggle-icon"></i>
        </div>
        <div class="thinking-content"></div>
      `;
      // Add click listener
      box.querySelector('.thinking-header').addEventListener('click', (e) => {
        e.stopPropagation();
        box.classList.toggle('collapsed');
      });

      // Insert at top
      if (container.children.length === 0) {
        container.appendChild(box);
      } else {
        container.insertBefore(box, container.firstChild);
      }
    }

    if (endIndex !== -1) {
      thinkingPart = text.substring(startIndex + startTag.length, endIndex);
      answerPart = text.substring(0, startIndex) + text.substring(endIndex + endTag.length);

      // Auto-collapse when thinking is done
      if (box && !box.hasAttribute('data-auto-collapsed')) {
        box.classList.add('collapsed');
        box.setAttribute('data-auto-collapsed', 'true');
      }
    } else {
      thinkingPart = text.substring(startIndex + startTag.length);
      answerPart = text.substring(0, startIndex);
    }

    // Update Thinking Content
    const thinkingContent = box.querySelector('.thinking-content');
    const newThinkingHtml = renderMarkdown(thinkingPart);
    if (thinkingContent.innerHTML !== newThinkingHtml) {
      thinkingContent.innerHTML = newThinkingHtml;
    }

    // 2. Handle Answer
    let answerContainer = container.querySelector('.answer-content');
    if (!answerContainer) {
      answerContainer = document.createElement('div');
      answerContainer.className = 'answer-content';
      container.appendChild(answerContainer);
    }
    const newAnswerHtml = renderMarkdown(answerPart);
    if (answerContainer.innerHTML !== newAnswerHtml) {
      answerContainer.innerHTML = newAnswerHtml;
    }
  } else {
    // No thinking tags found.
    // If we previously had a box, we might want to keep it or remove it.
    // For safety in streaming (where tags might appear later or disappear?),
    // if we don't see tags, we just render text.
    // But to avoid trashing if we just haven't received the tag yet (unlikely as it's usually first),
    // we'll just overwrite.
    container.innerHTML = renderMarkdown(text);
  }
}

function renderWithThinking(text, forceCollapsed = false) {
  if (!text) return '';

  const startTag = '<think>';
  const endTag = '</think>';
  const startIndex = text.indexOf(startTag);

  if (startIndex !== -1) {
    let thinkingPart = '';
    let answerPart = '';
    const endIndex = text.indexOf(endTag, startIndex);

    if (endIndex !== -1) {
      // Closed block
      thinkingPart = text.substring(startIndex + startTag.length, endIndex);
      answerPart = text.substring(0, startIndex) + text.substring(endIndex + endTag.length);
    } else {
      // Open block (still thinking)
      thinkingPart = text.substring(startIndex + startTag.length);
      answerPart = text.substring(0, startIndex);
    }

    let html = '';
    if (thinkingPart.trim()) {
      // Auto-collapse if finished (endIndex found) or forced
      const isFinished = endIndex !== -1;
      const collapsedClass = forceCollapsed || isFinished ? ' collapsed' : '';
      html += `
        <div class="thinking-box${collapsedClass}">
          <div class="thinking-header" onclick="this.parentElement.classList.toggle('collapsed')">
            <span><i class="fas fa-brain"></i> Thought Process</span>
            <i class="fas fa-chevron-down toggle-icon"></i>
          </div>
          <div class="thinking-content">${renderMarkdown(thinkingPart)}</div>
        </div>`;
    }

    if (answerPart.trim()) {
      html += renderMarkdown(answerPart);
    } else if (!thinkingPart.trim()) {
      // If both empty, show nothing
    }

    return html;
  }

  return renderMarkdown(text);
}

window.copyToClipboard = function (btn) {
  const wrapper = btn.closest('.code-block-wrapper');
  if (!wrapper) return;
  const codeDiv = wrapper.querySelector('.raw-code');
  // Use textContent to get back the unescaped code
  const code = codeDiv.textContent;

  navigator.clipboard.writeText(code).then(() => {
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => (btn.innerHTML = original), 2000);
  });
};

// --- INIT ---
window.addEventListener('DOMContentLoaded', () => {
  // Initialize App Immediately (Serverless Mode)
  initializeApp();

  // Import Session Logic
  const btnImport = document.getElementById('btn-import-session');
  const fileInput = document.getElementById('import-session-file');

  if (btnImport && fileInput) {
    btnImport.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const session = JSON.parse(text);
        if (session.id && session.messages) {
          // Save to LocalStorage
          await fsWriteFile('conversations', `${session.id}.json`, session);
          // Reload list
          await loadSessions();
          switchSession(session.id);
        } else {
          alert('Invalid session file format.');
        }
      } catch (err) {
        console.error('Import failed', err);
        alert('Failed to import session.');
      }
      fileInput.value = ''; // Reset
    });
  }

  // Global Click to close context menu
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('context-menu');
    if (!menu.contains(e.target) && !e.target.closest('.session-menu-btn')) {
      menu.classList.remove('show');
    }
  });

  // Context Menu Actions
  // (Listeners moved to renderSessionList or defined globally below to avoid duplicates)
  // We remove the old listeners here to prevent multiple bindings if this init runs again (it shouldn't but safe)

  document.getElementById('ctx-delete').addEventListener('click', () => {
    const menu = document.getElementById('context-menu');
    const sessionId = menu.dataset.sessionId;
    menu.classList.remove('show');
    deleteSession(sessionId);
  });

  // New Session Button (Now just "New Chat")
  document.getElementById('btn-new-session').addEventListener('click', () => {
    createNewSession('chat');
  });

  // Header Buttons
  document.getElementById('btn-copy-all').addEventListener('click', copyAllMessages);
  document.getElementById('btn-summarize').addEventListener('click', summarizeChat);

  // Submit/Stop Button
  const btnSubmit = document.getElementById('btn-submit');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', () => {
      if (isGenerating) {
        // Stop action
        if (currentController) {
          currentController.abort();
        }
      } else {
        // Send action
        handleInput();
      }
    });
  }

  // Input Mode Toggles
  const btnResearch = document.getElementById('btn-mode-research');
  const btnCouncil = document.getElementById('btn-mode-council');
  const btnThinking = document.getElementById('btn-mode-thinking');
  // btnCustom removed

  function updateInputPlaceholder() {
    const input = document.getElementById('question');
    if (!input) return;

    if (isCouncilMode) {
      input.placeholder = 'Send a message to the Council...';
    } else {
      // Try to get current model name
      let modelName = 'Model';
      if (currentSession) {
        if (currentSession.customModel) {
          modelName = currentSession.customModel.name;
        } else {
          const p = personas[currentSession.modelIndex];
          if (p) modelName = p.name;
        }
      }
      input.placeholder = `Send a message to ${modelName}...`;
    }

    // Update Status Text
    const sysMsg = document.querySelector('.system-message');
    if (sysMsg) {
      let modeText = isCouncilMode ? 'Council' : 'Single';
      if (isResearchMode) modeText += ' + Research';
      if (isThinkingMode) modeText += ' + Thinking';
      sysMsg.textContent = `System ready. Mode: ${modeText}.`;
    }
  }

  function setMode(mode, btn) {
    // Toggle logic
    if (mode === 'council') {
      isCouncilMode = !isCouncilMode;
      btn.classList.toggle('active', isCouncilMode);

      // Auto-Enable Thinking when Council is turned ON
      if (isCouncilMode) {
        isThinkingMode = true;
        const btnThinking = document.getElementById('btn-mode-thinking');
        if (btnThinking) btnThinking.classList.add('active');
      }
    } else if (mode === 'research') {
      isResearchMode = !isResearchMode;
      btn.classList.toggle('active', isResearchMode);
    } else if (mode === 'thinking') {
      isThinkingMode = !isThinkingMode;
      btn.classList.toggle('active', isThinkingMode);
    }

    console.log(
      'Mode updated:',
      'Council:',
      isCouncilMode,
      '| Research:',
      isResearchMode,
      '| Thinking:',
      isThinkingMode,
    );
    updateInputPlaceholder();
  }

  if (btnResearch) btnResearch.addEventListener('click', () => setMode('research', btnResearch));
  if (btnCouncil) btnCouncil.addEventListener('click', () => setMode('council', btnCouncil));
  if (btnThinking) btnThinking.addEventListener('click', () => setMode('thinking', btnThinking));
  // btnCustom removed

  // Add Model Modal
  const modal = document.getElementById('add-persona-modal');
  const btnOpenModal = document.getElementById('btn-open-add-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelPersona = document.getElementById('btn-cancel-persona');
  const btnSavePersona = document.getElementById('btn-save-persona');
  const colorPicker = document.getElementById('new-persona-color');
  const colorTextInput = document.getElementById('new-persona-color-text');

  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', () => {
      console.log('Open Modal Clicked');
      editingIndex = null; // Reset to add mode
      const header = document.querySelector('.modal-header h3');
      if (header) header.textContent = 'Add Council Member';

      // Reset fields safely
      const nameInput = document.getElementById('new-persona-name');
      if (nameInput) nameInput.value = '';

      const promptInput = document.getElementById('new-persona-prompt');
      if (promptInput) promptInput.value = '';

      const modelIdInput = document.getElementById('new-persona-model-id');
      if (modelIdInput) modelIdInput.value = '';

      const cp = document.getElementById('new-persona-color');
      if (cp) cp.value = '#00ff00';

      const cti = document.getElementById('new-persona-color-text');
      if (cti) cti.value = '#00ff00';

      if (modal) modal.classList.add('show');
      if (nameInput) nameInput.focus();
    });
  } else {
    console.error('btn-open-add-modal not found');
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeEditModal);
  if (btnCancelPersona) btnCancelPersona.addEventListener('click', closeEditModal);

  if (colorPicker && colorTextInput) {
    // Sync Picker -> Text
    colorPicker.addEventListener('input', (e) => {
      colorTextInput.value = e.target.value;
    });

    // Sync Text -> Picker
    colorTextInput.addEventListener('input', (e) => {
      const val = e.target.value;
      // Simple hex validation
      if (/^#[0-9A-F]{6}$/i.test(val)) {
        colorPicker.value = val;
      }
    });
  }

  if (btnSavePersona) {
    btnSavePersona.addEventListener('click', () => {
      const nameInput = document.getElementById('new-persona-name');
      const promptInput = document.getElementById('new-persona-prompt');
      const modelIdInput = document.getElementById('new-persona-model-id');
      const cp = document.getElementById('new-persona-color');
      const cti = document.getElementById('new-persona-color-text');

      const name = nameInput ? nameInput.value.trim() : '';
      const prompt = promptInput ? promptInput.value.trim() : '';
      const modelId = modelIdInput ? modelIdInput.value.trim() : '';

      // Prefer text input value if valid, else picker
      let color = cp ? cp.value : '#00ff00';
      if (cti) {
        const textVal = cti.value;
        if (/^#[0-9A-F]{6}$/i.test(textVal)) {
          color = textVal;
        }
      }

      if (name && prompt) {
        if (editingIndex !== null) {
          // Update existing
          updateModel(editingIndex, name, prompt, color, modelId);
        } else {
          // Add new
          addModel(name, prompt, color, modelId);
        }
        closeEditModal();
      } else {
        alert('Please enter a name and a system prompt.');
      }
    });
  }

  // Delete Modal Listeners
  // Note: btnCloseDelete was removed from HTML in popover version
  const btnCancelDelete = document.getElementById('btn-cancel-delete');
  const btnConfirmDelete = document.getElementById('btn-confirm-delete');

  if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteModal);
  if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', confirmDeleteModel);

  // Close popover when clicking outside
  document.addEventListener('click', (e) => {
    const modal = document.getElementById('delete-confirm-modal');
    if (modal && modal.classList.contains('show')) {
      // If click is NOT inside the modal AND NOT on a delete button
      if (!modal.contains(e.target) && !e.target.closest('.btn-delete-model')) {
        closeDeleteModal();
      }
    }
  });

  // --- SAVED MODELS LOGIC ---
  loadSavedModels();

  const btnAddModelDef = document.getElementById('btn-add-model-def');
  const modalModelDef = document.getElementById('add-model-def-modal');
  const btnCloseModelDef = document.getElementById('btn-close-model-def');
  const btnCancelModelDef = document.getElementById('btn-cancel-model-def');
  const btnSaveModelDef = document.getElementById('btn-save-model-def');

  if (btnAddModelDef) {
    btnAddModelDef.addEventListener('click', () => {
      document.getElementById('new-model-def-name').value = '';
      document.getElementById('new-model-def-id').value = '';
      modalModelDef.classList.add('show');
      document.getElementById('new-model-def-name').focus();
    });
  }

  const closeModelDefModal = () => {
    modalModelDef.classList.remove('show');
  };

  if (btnCloseModelDef) btnCloseModelDef.addEventListener('click', closeModelDefModal);
  if (btnCancelModelDef) btnCancelModelDef.addEventListener('click', closeModelDefModal);

  if (btnSaveModelDef) {
    btnSaveModelDef.addEventListener('click', async () => {
      const name = document.getElementById('new-model-def-name').value.trim();
      const id = document.getElementById('new-model-def-id').value.trim();

      if (name && id) {
        savedModels.push({ name, id });
        await saveSavedModels();
        closeModelDefModal();
      } else {
        alert('Please enter both a name and a model ID.');
      }
    });
  }

  // New: Fetch Loaded ID Button Logic
  const btnFetchId = document.getElementById('btn-fetch-loaded-id');
  if (btnFetchId) {
    btnFetchId.addEventListener('click', async () => {
      try {
        const res = await fetch('http://127.0.0.1:1234/v1/models');
        const data = await res.json();
        if (data.data && data.data.length > 0) {
          const loadedId = data.data[0].id;
          document.getElementById('new-model-def-id').value = loadedId;
          // Also suggest a name if empty
          const nameInput = document.getElementById('new-model-def-name');
          if (!nameInput.value) {
            // Clean up ID to make a nice name
            let niceName = loadedId.split('/').pop().replace(/-|_/g, ' ').toUpperCase();
            nameInput.value = niceName;
          }
        } else {
          alert('No model is currently loaded in LM Studio. Please load one manually first.');
        }
      } catch (e) {
        alert('Could not connect to LM Studio. Is it running on port 1234?');
      }
    });
  }
});

// --- STATS MANAGEMENT ---
function loadStats() {
  const stored = localStorage.getItem('colossus_stats');
  if (stored) {
    systemStats = JSON.parse(stored);
  }
  updateStatsUI();
}

function saveStats() {
  localStorage.setItem('colossus_stats', JSON.stringify(systemStats));
  updateStatsUI();
}

function updateStatsUI() {
  document.getElementById('stat-requests').textContent = systemStats.requests;
  document.getElementById('stat-prompt').textContent = systemStats.promptTokens.toLocaleString();
  document.getElementById('stat-completion').textContent =
    systemStats.completionTokens.toLocaleString();
  document.getElementById('stat-speed').textContent = systemStats.lastSpeed.toFixed(1) + ' T/s';

  // Simple visual bars (just for effect, cycling 0-100 based on modulo)
  document.getElementById('bar-requests').style.width = (systemStats.requests % 100) + '%';
  document.getElementById('bar-prompt').style.width =
    ((systemStats.promptTokens / 100) % 100) + '%';
  document.getElementById('bar-completion').style.width =
    ((systemStats.completionTokens / 100) % 100) + '%';

  // Speed bar is relative to 100 T/s max
  let speedPercent = (systemStats.lastSpeed / 100) * 100;
  if (speedPercent > 100) speedPercent = 100;
  document.getElementById('bar-speed').style.width = speedPercent + '%';
}

function trackUsage(usage, timeMs) {
  if (!usage) return;

  systemStats.requests++;
  systemStats.promptTokens += usage.prompt_tokens || 0;
  systemStats.completionTokens += usage.completion_tokens || 0;

  if (usage.completion_tokens > 0 && timeMs > 0) {
    // Calculate tokens per second
    const seconds = timeMs / 1000;
    systemStats.lastSpeed = usage.completion_tokens / seconds;
  }

  saveStats();
}

// --- SAVED MODELS ---
let savedModels = [];

async function loadSavedModels() {
  try {
    const data = await fsReadFile('data', 'models.json');
    savedModels = data || [];
  } catch (e) {
    console.error('Failed to load saved models', e);
    savedModels = [];
  }
  renderSavedModelsList();
}

async function saveSavedModels() {
  try {
    await fsWriteFile('data', 'models.json', savedModels);
  } catch (e) {
    console.error('Failed to save models', e);
  }
  renderSavedModelsList();
}

function renderSavedModelsList() {
  const listContainer = document.querySelector('.model-list');
  listContainer.innerHTML = '';

  // 1. Council Meeting Card
  const councilItem = document.createElement('div');
  councilItem.className = 'model-item';
  // Less intense, more height, normal colors
  councilItem.style.padding = '12px 10px';
  councilItem.style.marginBottom = '10px';
  councilItem.style.background = '#2a2a2a';
  councilItem.style.border = '1px solid #444';
  councilItem.style.display = 'flex';
  councilItem.style.justifyContent = 'space-between';
  councilItem.style.alignItems = 'center';

  councilItem.innerHTML = `
      <span style="color:#eee; font-weight:bold;">COUNCIL MEETING</span>
      <button class="btn-chat" id="btn-start-council" style="background:#333; color:#fff; border:1px solid #555; padding: 4px 10px;">START</button>
    `;
  listContainer.appendChild(councilItem);

  // Separator
  const separator = document.createElement('div');
  separator.style.borderBottom = '1px solid #333';
  separator.style.margin = '0 5px 10px 5px';
  listContainer.appendChild(separator);

  councilItem.querySelector('#btn-start-council').addEventListener('click', () => {
    createNewSession('council');
  });

  // 2. Saved Models
  savedModels.forEach((m, index) => {
    const item = document.createElement('div');
    item.className = 'model-item';
    item.innerHTML = `
        <span>${m.name}</span>
        <button class="btn-chat" data-model-index="${index}">+ Chat</button>
      `;
    listContainer.appendChild(item);
  });

  // Attach listeners
  listContainer.querySelectorAll('.btn-chat[data-model-index]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-model-index'));
      const model = savedModels[idx];
      // Start a single chat with this model ID
      createNewSession('chat', null, true, model);
    });
  });
}

// --- PERSONAS & MODELS ---
let personas = [];
let editingIndex = null;

async function loadPersonas() {
  try {
    const data = await fsReadFile('data', 'personas.json');
    personas = data || [];
  } catch (e) {
    console.error('Failed to load personas', e);
    personas = [];
  }

  // Polyfill class for runtime if missing
  personas.forEach((p) => {
    if (!p.class) {
      p.class = `msg-${p.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
    }
  });

  if (personas.length === 0) {
    // If empty, maybe initialize defaults?
    // For now, just let it be empty or user adds them.
  }
  injectPersonaStyles();
  renderModelList();
}

function injectPersonaStyles() {
  // Remove old dynamic styles if any
  const oldStyle = document.getElementById('dynamic-persona-styles');
  if (oldStyle) oldStyle.remove();

  const style = document.createElement('style');
  style.id = 'dynamic-persona-styles';

  let css = '';
  personas.forEach((p) => {
    // Ensure we have a valid color
    const color = p.color || '#ccc';
    css += `
      .${p.class} { border-left: 4px solid ${color} !important; }
      .${p.class} .msg-header { color: ${color} !important; }
    `;
  });

  style.innerHTML = css;
  document.head.appendChild(style);
}

async function savePersonas() {
  try {
    // Create a clean copy for saving (exclude runtime 'class' property)
    const toSave = personas.map((p) => {
      const { class: _, ...rest } = p;
      return rest;
    });

    await fsWriteFile('data', 'personas.json', toSave);
  } catch (e) {
    console.error('Failed to save personas', e);
  }
  renderModelList();
}

function addModel(name, prompt, color, modelId = null) {
  personas.push({
    name: name.toUpperCase(),
    class: `msg-custom-${Date.now()}`, // Unique class
    prompt: prompt,
    color: color,
    modelId: modelId, // Store specific model ID
  });

  savePersonas();
  injectPersonaStyles(); // Update styles immediately
  renderModelList(); // Update list
}

function updateModel(index, name, prompt, color, modelId) {
  const p = personas[index];
  p.name = name.toUpperCase();
  p.prompt = prompt;
  p.color = color;
  p.modelId = modelId;

  savePersonas();
  injectPersonaStyles();
  renderModelList();
}

function openEditModal(index) {
  editingIndex = index;
  const p = personas[index];
  const modal = document.getElementById('add-persona-modal');

  const nameInput = document.getElementById('new-persona-name');
  if (nameInput) nameInput.value = p.name;

  const promptInput = document.getElementById('new-persona-prompt');
  if (promptInput) promptInput.value = p.prompt;

  const modelIdInput = document.getElementById('new-persona-model-id');
  if (modelIdInput) modelIdInput.value = p.modelId || '';

  const cp = document.getElementById('new-persona-color');
  if (cp) cp.value = p.color || '#00ff00';

  const colorTextInput = document.getElementById('new-persona-color-text');
  if (colorTextInput) colorTextInput.value = p.color || '#00ff00';

  const header = document.querySelector('.modal-header h3');
  if (header) header.textContent = 'Edit Council Member';

  if (modal) modal.classList.add('show');
}

function closeEditModal() {
  const modal = document.getElementById('add-persona-modal');
  modal.classList.remove('show');
  editingIndex = null;
}

// --- DELETE MODAL LOGIC ---
let deleteTargetIndex = null;

function removeModel(index, event) {
  deleteTargetIndex = index;
  const p = personas[index];
  const modal = document.getElementById('delete-confirm-modal');
  const text = document.getElementById('delete-confirm-text');

  text.textContent = `Remove "${p.name}"?`;

  if (event) {
    const rect = event.currentTarget.getBoundingClientRect();
    // Position below the button, right aligned
    modal.style.top = `${rect.bottom + 5}px`;
    // Align right edge of modal with right edge of button (approx)
    // Or just center it relative to button?
    // Let's try to align it so it doesn't go off screen.
    // Since it's on the right sidebar, aligning right edges is safer.
    // But we don't know modal width exactly until rendered.
    // Let's guess width is 200px.
    modal.style.left = `${rect.right - 200}px`;
  }

  modal.classList.add('show');
}

function closeDeleteModal() {
  const modal = document.getElementById('delete-confirm-modal');
  modal.classList.remove('show');
  deleteTargetIndex = null;
}

function confirmDeleteModel() {
  if (deleteTargetIndex !== null) {
    personas.splice(deleteTargetIndex, 1);
    savePersonas();
    closeDeleteModal();
  }
}

const input = document.getElementById('question');
const messagesContainer = document.getElementById('messages');

// --- UI STATE ---
let isCouncilMode = false; // Default OFF
let isResearchMode = false; // Default OFF

// --- SESSION MANAGEMENT ---
let currentSession = null; // Holds the full active session object

async function loadSessions() {
  try {
    const files = await fsListFiles('conversations');
    // Load all session files to build the list (or just metadata if we had a separate index)
    // For now, we load all.
    const loaded = [];
    for (const f of files) {
      const s = await fsReadFile('conversations', f);
      if (s) loaded.push(s);
    }
    // Sort by lastModified desc
    loaded.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
    sessions = loaded;
  } catch (e) {
    console.error('Failed to load sessions list', e);
    sessions = [];
  }

  if (sessions.length === 0) {
    // Default initial session
    createNewSession('council', null, false);
  } else {
    // Load the most recent one
    switchSession(sessions[0].id);
  }
  renderSessionList();
}

async function saveCurrentSession() {
  if (!currentSession) return;

  try {
    await fsWriteFile('conversations', `${currentSession.id}.json`, currentSession);

    // Update the list metadata locally to reflect changes (like name or lastModified)
    const listIndex = sessions.findIndex((s) => s.id === currentSession.id);
    if (listIndex >= 0) {
      sessions[listIndex].name = currentSession.name;
      sessions[listIndex].lastModified = Date.now();
      sessions[listIndex].messages = currentSession.messages; // Keep sync
      // Move to top
      const item = sessions.splice(listIndex, 1)[0];
      sessions.unshift(item);
    } else {
      // Add new
      sessions.unshift(currentSession);
    }
    renderSessionList();
  } catch (e) {
    console.error('Failed to save session', e);
  }
}

// Alias for compatibility with old code calls
function saveSessions() {
  saveCurrentSession();
}

async function createNewSession(type, modelIndex = null, autoSwitch = true, customModel = null) {
  // Reset Research Mode defaults for new sessions
  isResearchMode = false;
  const btnResearch = document.getElementById('btn-mode-research');
  if (btnResearch) btnResearch.classList.remove('active');

  const id = Date.now().toString();
  // Default to first model if none specified
  if (modelIndex === null) modelIndex = 0;

  let name = 'New Chat';
  let realModelId = window.lastLoadedModelId || 'unknown';

  if (customModel) {
    realModelId = customModel.id;
  } else if (personas[modelIndex]) {
    realModelId = personas[modelIndex].modelId || window.lastLoadedModelId || 'unknown';
  }

  const newSession = {
    id,
    type,
    modelIndex,
    name,
    realModelId,
    customModel,
    messages: [],
    lastModified: Date.now(),
  };

  // Save immediately to create file
  try {
    await fsWriteFile('conversations', `${id}.json`, newSession);

    // Add to local list
    sessions.unshift(newSession);
    renderSessionList();

    if (autoSwitch) switchSession(id);
  } catch (e) {
    console.error('Failed to create session', e);
  }
}

function renameSession(sessionId) {
  const sessionEl = document.querySelector(`.session-item[data-id="${sessionId}"]`);
  if (sessionEl) {
    const infoDiv = sessionEl.querySelector('.session-info');
    const nameSpan = sessionEl.querySelector('.session-name-text');
    const currentName = nameSpan.textContent;

    // Replace span with input
    infoDiv.innerHTML = `<input type="text" class="session-name-input" value="${currentName}">`;
    const input = infoDiv.querySelector('input');

    input.focus();
    input.select();

    // Save on blur or enter
    const save = async () => {
      const newName = input.value.trim() || currentName;

      // If it's the current session, update object
      if (currentSession && currentSession.id === sessionId) {
        currentSession.name = newName;
        await saveCurrentSession();
      } else {
        // We need to fetch, update, save
        try {
          const s = await fsReadFile('conversations', `${sessionId}.json`);
          if (s) {
            s.name = newName;
            await fsWriteFile('conversations', `${sessionId}.json`, s);

            // Update local list
            const item = sessions.find((x) => x.id === sessionId);
            if (item) item.name = newName;
          }
          renderSessionList();
        } catch (e) {
          console.error('Rename failed', e);
        }
      }
      renderSessionList(); // Re-render to show span again
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      }
    });
  }
}

async function deleteSession(id, e) {
  if (e) e.stopPropagation();

  // No confirmation dialog
  // if (!confirm('Delete this conversation?')) return;

  try {
    await fsDeleteFile('conversations', `${id}.json`);

    sessions = sessions.filter((s) => s.id !== id);

    if (currentSessionId === id) {
      currentSessionId = null;
      currentSession = null;
      messagesContainer.innerHTML = '';

      if (sessions.length > 0) {
        switchSession(sessions[0].id);
      } else {
        createNewSession('council');
      }
    }
    renderSessionList();
  } catch (e) {
    console.error('Delete failed', e);
  }
}

async function switchSession(id) {
  // If switching to same session, do nothing
  if (currentSessionId === id) return;

  try {
    const session = await fsReadFile('conversations', `${id}.json`);
    if (!session) throw new Error('Session not found');

    currentSession = session;
    currentSessionId = id;

    // Sync UI Mode
    isCouncilMode = session.type === 'council';

    // Update Buttons
    const btnResearch = document.getElementById('btn-mode-research');
    const btnCouncil = document.getElementById('btn-mode-council');
    // btnCustom removed

    // Reset UI state based on session type
    // Note: Research mode is not stored in session currently, so it defaults to off or keeps current state?
    // Let's keep current state for research, but sync council mode.

    isCouncilMode = session.type === 'council';
    if (btnCouncil) btnCouncil.classList.toggle('active', isCouncilMode);

    // Auto-Enable Thinking for Council Mode (User Request)
    if (isCouncilMode) {
      isThinkingMode = true;
    }
    // Update Thinking Button State
    const btnThinking = document.getElementById('btn-mode-thinking');
    if (btnThinking) btnThinking.classList.toggle('active', isThinkingMode);

    // Research mode persists across session switches unless we want to reset it.
    // User didn't specify, but usually mode toggles are session-independent or reset.
    // Let's keep it as is (user manually toggles it).
    if (btnResearch) btnResearch.classList.toggle('active', isResearchMode);

    // Update UI Header
    const title = `Session: ${session.name}`;
    document.querySelector('.header-title').textContent = title;

    // Update Placeholder
    const input = document.getElementById('question');
    if (input) {
      let modelName = 'Model';
      if (session.customModel) {
        modelName = session.customModel.name;
      } else {
        const p = personas[session.modelIndex];
        if (p) modelName = p.name;
      }
      input.placeholder = isCouncilMode
        ? 'Send a message to the Council...'
        : `Send a message to ${modelName}...`;
    }

    // Render Messages
    messagesContainer.innerHTML = '';
    if (!session.messages || session.messages.length === 0) {
      let modeText = isCouncilMode ? 'Council' : 'Single';
      if (isResearchMode) modeText += ' + Research';
      messagesContainer.innerHTML = `<div class="system-message">System ready. Mode: ${modeText}.</div>`;
    } else {
      session.messages.forEach((msg) => {
        if (msg.role === 'user') {
          messagesContainer.appendChild(createMessageCard(msg.content, 'msg-user', 'USER'));
        } else if (msg.role === 'assistant') {
          if (msg.type === 'consensus') {
            const div = document.createElement('div');
            div.className = 'msg-card msg-final';
            div.innerHTML = `
               <div class="final-header">
                 <i class="fas fa-history"></i> SYSTEM CONSENSUS (HISTORY)
               </div>
               <div class="final-body">
                 ${renderMarkdown(msg.content)}
               </div>
             `;
            messagesContainer.appendChild(div);
          } else {
            const p = personas[session.modelIndex] || personas[0];
            // Fallback if persona index is out of bounds or changed
            const pName = p ? p.name : 'Unknown';
            const pClass = p ? p.class : 'msg-custom';
            messagesContainer.appendChild(createMessageCard(msg.content, pClass, pName));
          }
        }
      });
    }
    scrollToBottom();
    renderSessionList();
  } catch (e) {
    console.error('Switch session failed', e);
  }
}

function renderSessionList() {
  const list = document.getElementById('session-list');
  list.innerHTML = '';

  sessions.forEach((s) => {
    const div = document.createElement('div');
    div.className = `session-item ${s.id === currentSessionId ? 'active' : ''}`;
    div.dataset.id = s.id; // Store ID for lookup

    // Determine model info
    let modelInfo = '';
    if (s.type === 'council') {
      modelInfo = 'Council Meeting';
    } else if (s.customModel) {
      modelInfo = s.customModel.name;
    } else {
      const p = personas[s.modelIndex] || personas[0];
      // Show Model ID instead of Persona Name
      modelInfo = p ? p.modelId || p.name : 'Unknown';
    }

    div.innerHTML = `
      <div class="session-info">
        <span class="session-name-text">${s.name}</span>
        <div class="session-meta">${modelInfo}</div>
      </div>
      <div class="session-actions">
        <button class="action-icon btn-edit" title="Rename"><i class="fas fa-pen"></i></button>
        <button class="action-icon btn-delete" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    `;

    // Click to switch
    div.addEventListener('click', (e) => {
      // Don't switch if clicking menu or input
      if (e.target.closest('.session-actions') || e.target.tagName === 'INPUT') return;
      switchSession(s.id);
    });

    // Edit Logic
    const editBtn = div.querySelector('.btn-edit');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      renameSession(s.id);
    });

    // Delete Logic
    const deleteBtn = div.querySelector('.btn-delete');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(s.id);
    });

    list.appendChild(div);
  });
}

// --- CONTEXT MENU HANDLERS ---
// (Deprecated / Removed)
/*
document.getElementById('ctx-rename').addEventListener('click', () => {
  // ...
});
*/

// --- HELPER FUNCTIONS ---
function getLoaderHtml() {
  return `<div class="loader-wrapper"><div class="block-loader"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div><span>Loading...</span></div>`;
}

function createMessageCard(text, type, headerText) {
  const div = document.createElement('div');
  div.className = `msg-card ${type}`;

  const header = document.createElement('div');
  header.className = 'msg-header';

  // Fix: Check if text is loader HTML to avoid counting HTML chars
  const isLoader = text.includes('loader-wrapper');
  const meta = isLoader ? '' : `${text.length} chars`;

  header.innerHTML = `<span>${headerText}</span> <span>${meta}</span>`;

  const content = document.createElement('div');
  content.className = 'msg-content';
  content.innerHTML = renderWithThinking(text);

  div.appendChild(header);
  div.appendChild(content);
  return div;
}

function scrollToBottom(smooth = true) {
  messagesContainer.scrollTo({
    top: messagesContainer.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

function smartScroll() {
  // Nur scrollen, wenn der User bereits unten ist (oder fast)
  const threshold = 200;
  const isNearBottom =
    messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight <
    threshold;

  if (isNearBottom) {
    scrollToBottom(true);
  }
}

async function fetchLoadedModels() {
  try {
    const res = await fetch('http://127.0.0.1:1234/v1/models');
    const data = await res.json();
    console.log('Loaded models:', data);

    if (data.data && data.data.length > 0) {
      window.lastLoadedModelId = data.data[0].id;
    }

    // We just use this to verify connection, the UI is now driven by 'personas'
    renderModelList();
  } catch (e) {
    console.error('Could not fetch models:', e);
    renderModelList(); // Render anyway
  }
}

function renderModelList() {
  // Update Right Sidebar Active Models ONLY
  const activeModelsList = document.getElementById('active-models-list');
  activeModelsList.innerHTML = '';

  personas.forEach((p, index) => {
    // Right Sidebar Item
    const activeItem = document.createElement('div');
    activeItem.className = 'process-row';
    activeItem.style.display = 'flex';
    activeItem.style.justifyContent = 'space-between';
    activeItem.style.alignItems = 'center';
    activeItem.style.padding = '4px 0';

    activeItem.innerHTML = `
        <span style="color: ${p.color || '#ccc'}">${p.name}</span>
        <div style="display:flex; gap:5px; align-items:center;">
            <button class="action-icon btn-edit-model" data-index="${index}" title="Edit Member" style="background:none; border:none; color:#666; cursor:pointer; font-size: 0.8rem;">
                <i class="fas fa-pen"></i>
            </button>
            <button class="action-icon btn-delete-model" data-index="${index}" title="Remove Member" style="background:none; border:none; color:#444; cursor:pointer;">
                <i class="fas fa-times"></i>
            </button>
        </div>
      `;
    activeModelsList.appendChild(activeItem);
  });

  // Re-attach listeners for Right Sidebar
  document.querySelectorAll('.btn-edit-model').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-index'));
      openEditModal(idx);
    });
  });

  document.querySelectorAll('.btn-delete-model').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-index'));
      removeModel(idx, e);
    });
  });
}

// --- HEADER ACTIONS ---
function copyAllMessages() {
  const session = sessions.find((s) => s.id === currentSessionId);
  if (!session) return;

  const text = session.messages.map((m) => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-copy-all');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = original), 2000);
  });
}

async function summarizeChat() {
  const session = sessions.find((s) => s.id === currentSessionId);
  if (!session || session.messages.length === 0) return;

  const btn = document.getElementById('btn-summarize');
  btn.textContent = 'Summarizing...';

  try {
    const messages = [
      ...session.messages,
      { role: 'user', content: 'Summarize the above conversation in 3 bullet points.' },
    ];

    const modelId = window.lastLoadedModelId || 'local-model';
    const res = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: messages,
        max_tokens: 200,
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    const summary = data.choices[0].message.content;

    // Show summary in a modal or alert for now, or append to chat?
    // Let's append as a system note
    const div = document.createElement('div');
    div.className = 'msg-card';
    div.style.borderLeft = '4px solid #fff';
    div.innerHTML = `<div class="msg-header">SUMMARY</div><div class="msg-content">${renderMarkdown(
      summary,
    )}</div>`;
    messagesContainer.appendChild(div);
    scrollToBottom();
  } catch (e) {
    alert('Failed to summarize: ' + e.message);
  } finally {
    btn.textContent = 'Summarize';
  }
}

// --- CORE LOGIC ---

let isGenerating = false; // Global flag to prevent double submission
let currentController = null; // Global AbortController
let isThinkingMode = false; // Global flag for Thinking Mode

// Helper to clean <think> tags from history to prevent context pollution
function getCleanHistory(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('<think>')) {
      return { ...m, content: m.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim() };
    }
    return m;
  });
}

// Helper to determine the correct model ID for a session
function getModelIdForSession(session) {
  if (!session) return window.lastLoadedModelId || 'local-model';

  if (session.customModel && session.customModel.id) {
    return session.customModel.id;
  }

  if (session.modelIndex !== null && personas[session.modelIndex]) {
    const p = personas[session.modelIndex];
    if (p.modelId) return p.modelId;
  }

  return window.lastLoadedModelId || 'local-model';
}

async function searchWeb(query) {
  console.log('[searchWeb] Starting search for:', query);
  const proxyUrl = 'https://api.allorigins.win/raw?url=';
  const targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // Increased to 10s

  try {
    const res = await fetch(proxyUrl + encodeURIComponent(targetUrl), {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error('[searchWeb] Proxy returned status:', res.status);
      throw new Error(`Proxy error: ${res.status}`);
    }

    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const results = [];
    // Try multiple selectors as DDG changes often
    const elements = doc.querySelectorAll('.result, .web-result, .links_main');

    elements.forEach((el) => {
      const titleEl = el.querySelector('.result__a, .result__title a, .links_main a');
      const snippetEl = el.querySelector(
        '.result__snippet, .result__snippet, .links_main__snippet',
      );

      if (titleEl && snippetEl) {
        results.push({
          title: titleEl.textContent.trim(),
          snippet: snippetEl.textContent.trim(),
          link: titleEl.getAttribute('href'),
        });
      }
    });

    console.log('[searchWeb] Found results:', results.length);
    return results.slice(0, 5); // Top 5
  } catch (e) {
    console.error('[searchWeb] Search failed:', e);
    return [];
  }
}

async function generateSearchQuery(userPrompt, modelId) {
  console.log('[generateSearchQuery] Generating query for:', userPrompt, 'with model:', modelId);
  try {
    const controller = new AbortController();
    // Increased timeout to 120s to allow for model loading (large models can take time)
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    // Use passed modelId or fallback
    const targetModel = modelId || window.lastLoadedModelId || 'local-model';

    const res = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that generates web search queries. Your task is to extract the most relevant keywords from the user\'s request to form a single, effective search query.\n\nRULES:\n1. Output ONLY the search query.\n2. Do NOT include "Here is the query" or any conversational text.\n3. Do NOT use quotes.\n4. Keep it concise (3-6 keywords).',
          },
          { role: 'user', content: `Generate a search query for: "${userPrompt}"` },
        ],
        max_tokens: 50,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error('[generateSearchQuery] API error:', res.status);
      return userPrompt;
    }

    const data = await res.json();
    let query = data.choices[0].message.content.trim();

    // Cleanup common model chatter
    query = query
      .replace(/^Here is the search query:?/i, '')
      .replace(/^Search query:?/i, '')
      .replace(/^Query:?/i, '')
      .replace(/^(Sure|Okay|Here|Certainly|The query is|I suggest).*?[:\n]/i, '') // Aggressive conversational cleanup
      .replace(/<think>[\s\S]*?<\/think>/gi, '') // Remove think tags if present
      .replace(/<think>[\s\S]*/i, '') // Remove unclosed think tags (rest of string)
      .replace(/^["']|["']$/g, '')
      .trim();

    // Fallback if empty or too long (hallucination)
    if (!query || query.length > 100) {
      console.warn(
        '[generateSearchQuery] Generated query seemed invalid, using original prompt:',
        query,
      );
      return userPrompt;
    }

    console.log('[generateSearchQuery] Final query:', query);
    return query;
  } catch (e) {
    console.error('[generateSearchQuery] Failed:', e);
    return userPrompt; // Fallback
  }
}

async function handleInput() {
  if (isGenerating) return; // Prevent multiple clicks/enters

  const q = input.value.trim();
  if (!q) return;

  input.value = '';

  // Use global currentSession instead of finding in list (which is now just metadata)
  if (!currentSession) return;

  // Remove "System Ready" message if present
  const sysMsg = messagesContainer.querySelector('.system-message');
  if (sysMsg) sysMsg.remove();

  isGenerating = true; // Lock
  currentController = new AbortController();

  // Update Button Icon to Stop
  const btnSubmit = document.getElementById('btn-submit');
  if (btnSubmit) {
    btnSubmit.innerHTML = '<i class="fas fa-square"></i>';
    btnSubmit.title = 'Stop Generation';
  }

  try {
    let searchResults = null;

    // 1. Research Phase (if active)
    if (isResearchMode) {
      searchResults = []; // Initialize as array only if research is active
      // Show User Message immediately
      const userMsg = createMessageCard(q, 'msg-user', 'USER');
      messagesContainer.appendChild(userMsg);
      scrollToBottom();

      // Generate Query & Search
      const statusDiv = document.createElement('div');
      statusDiv.className = 'msg-card msg-system';
      statusDiv.style.padding = '5px 15px';
      statusDiv.style.opacity = '0.7';
      statusDiv.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Generating search query...`;
      messagesContainer.appendChild(statusDiv);
      scrollToBottom();

      console.log('[handleInput] Step 1: Generating Query');

      // Determine Model ID for Search Query Generation
      let searchModelId = getModelIdForSession(currentSession);
      console.log('[handleInput] Resolved Search Model ID:', searchModelId);
      if (isCouncilMode) {
        // In Council Mode, use the first available model or global default
        // Or maybe we should pick a specific "Researcher" persona if one exists?
        // For now, default to global loaded
        searchModelId = window.lastLoadedModelId || 'local-model';
      }

      const searchQuery = await generateSearchQuery(q, searchModelId);

      statusDiv.innerHTML = `<i class="fas fa-search"></i> Searching for: "${searchQuery}"...`;

      console.log('[handleInput] Step 2: Searching Web');
      searchResults = await searchWeb(searchQuery);

      // Remove status div
      statusDiv.remove();
    }

    // 2. Execution Phase
    if (isCouncilMode) {
      // If research mode was active, user msg is already added.
      // If NOT research mode, askCouncil usually adds it.
      // We need to handle this duplication.
      // Let's pass a flag to askCouncil to skip adding user msg if we already did.
      await askCouncil(q, currentSession, currentController.signal, searchResults, isResearchMode);
    } else {
      // Single Mode
      await askSingleModel(
        q,
        currentSession,
        currentController.signal,
        searchResults,
        isResearchMode,
      );
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('Generation stopped by user.');
    } else {
      console.error('Error in handleInput:', e);
    }
  } finally {
    isGenerating = false; // Unlock
    currentController = null;

    // Reset Button Icon to Send
    if (btnSubmit) {
      btnSubmit.innerHTML = '<i class="fas fa-paper-plane"></i>';
      btnSubmit.title = 'Send Message';
    }
  }
}

async function streamResponse(params, onChunk, onComplete, onError, signal) {
  console.log('[streamResponse] Initiating fetch to LM Studio...', params);

  try {
    const response = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        max_tokens: params.max_tokens,
        temperature: params.temperature,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: signal, // Pass the signal
    });

    console.log('[streamResponse] Response status:', response.status);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[streamResponse] Error body:', errText);
      throw new Error(`HTTP Error: ${response.status} - ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((line) => line.trim() !== '');

      for (const line of lines) {
        if (line === 'data: [DONE]') continue;
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.substring(6));
            if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
              const content = json.choices[0].delta.content;
              fullText += content;
              if (onChunk) onChunk(content, fullText);
            }
            if (json.usage) {
              usage = json.usage;
            }
          } catch (e) {
            console.error('Error parsing stream chunk', e);
          }
        }
      }
    }
    if (onComplete) onComplete(fullText, usage);
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('Stream aborted');
    } else {
      console.error('Stream failed', e);
    }
    if (onError) onError(e);
  }
}
async function generateTitle(session, firstUserMessage) {
  // Wait 1s to let the server finish the previous stream and cool down
  await new Promise((r) => setTimeout(r, 1000));

  let title = '';
  try {
    // Ensure we have a valid model ID
    let modelId = window.lastLoadedModelId;
    if (session.customModel && session.customModel.id) {
      modelId = session.customModel.id;
    }
    if (!modelId) {
      try {
        const mRes = await fetch('http://127.0.0.1:1234/v1/models');
        const mData = await mRes.json();
        if (mData.data && mData.data.length > 0) modelId = mData.data[0].id;
      } catch (e) {
        console.error('Model fetch failed inside generateTitle', e);
      }
    }
    modelId = modelId || 'local-model';

    // Truncate input to avoid context issues
    const promptContent =
      firstUserMessage.length > 500 ? firstUserMessage.substring(0, 500) + '...' : firstUserMessage;

    const res = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: 'system',
            content:
              "Generate a very short title (max 4 words) for this chat based on the user's message. Output ONLY the title text. Do NOT use <think> tags or quotes.",
          },
          { role: 'user', content: promptContent },
        ],
        max_tokens: 1000, // Increased to allow for thinking if model ignores instruction
        temperature: 0.7,
      }),
    });
    const data = await res.json();
    title = data.choices[0].message.content.trim();

    // Cleanup <think> tags if they still appear
    // Remove complete think blocks
    title = title.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // If there is still an open <think> (e.g. cut off or at start), remove it
    if (title.includes('<think>')) {
      // If we have content AFTER the think tag, try to keep it? No, usually think is first.
      // If it starts with think and no end tag, it's garbage.
      if (title.startsWith('<think>')) {
        title = '';
      } else {
        // Maybe think tag is in the middle? Remove everything from think onwards
        title = title.split('<think>')[0].trim();
      }
    }

    // If title is empty after cleaning, throw error to trigger fallback
    if (!title) throw new Error('Title empty after cleaning');

    // Cleanup quotes
    title = title.replace(/^["']|["']$/g, '');
  } catch (e) {
    console.error('Title generation failed', e);
    // Fallback to user message snippet if API fails
    title = firstUserMessage.substring(0, 25) + (firstUserMessage.length > 25 ? '...' : '');
  }

  // Final fallback
  if (!title || title.length === 0) title = 'New Chat';

  session.name = title;
  await saveCurrentSession(); // Use new save function
  // renderSessionList is called inside saveCurrentSession
}

async function askSingleModel(q, session, signal, searchResults = null, skipUserMsg = false) {
  let p;
  let modelIdToUse;

  if (session.customModel) {
    // Custom Model Chat
    p = {
      name: session.customModel.name,
      class: 'msg-custom-model',
      prompt: 'You are a helpful AI assistant.',
      modelId: session.customModel.id,
    };
    modelIdToUse = session.customModel.id;
  } else {
    // Persona Chat
    const index = session.modelIndex;
    p = personas[index];

    // Safety check
    if (!p) {
      const errDiv = createMessageCard(
        'Error: The selected persona could not be found. Please reload the page.',
        'msg-system',
        'SYSTEM',
      );
      messagesContainer.appendChild(errDiv);
      return;
    }
    modelIdToUse = p.modelId || window.lastLoadedModelId || 'local-model';
  }

  // 1. UI & History
  if (!skipUserMsg) {
    const userMsg = createMessageCard(q, 'msg-user', 'USER');
    messagesContainer.appendChild(userMsg);
  }

  session.messages.push({ role: 'user', content: q });
  await saveCurrentSession();

  scrollToBottom();

  // 2. Placeholder
  const placeholder = createMessageCard(getLoaderHtml(), p.class, p.name);
  messagesContainer.appendChild(placeholder);
  scrollToBottom();

  const contentDiv = placeholder.querySelector('.msg-content');
  const headerDiv = placeholder.querySelector('.msg-header span:last-child');

  // Prepare structure for search results + text
  contentDiv.innerHTML = ''; // Clear loader for a moment

  const searchContainer = document.createElement('div');
  searchContainer.className = 'search-container';
  contentDiv.appendChild(searchContainer);

  const textContainer = document.createElement('div');
  textContainer.className = 'text-container';
  textContainer.innerHTML = getLoaderHtml(); // Put loader here
  contentDiv.appendChild(textContainer);

  // Inject Search Results UI if present
  if (searchResults && Array.isArray(searchResults) && searchResults.length > 0) {
    const searchHtml = `
      <div class="search-box collapsed">
        <div class="search-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span><i class="fas fa-globe"></i> Found ${searchResults.length} Sources</span>
          <i class="fas fa-chevron-down toggle-icon"></i>
        </div>
        <div class="search-content">
          ${searchResults
            .map((r) => {
              let domain = 'google.com';
              try {
                if (r.link && r.link.startsWith('http')) {
                  domain = new URL(r.link).hostname;
                }
              } catch (e) {
                console.warn('Invalid URL in search result:', r.link);
              }
              const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
              return `
            <div class="search-item">
              <div class="search-item-top">
                <img src="${faviconUrl}" class="search-favicon" onerror="this.style.display='none'">
                <a href="${r.link}" target="_blank" title="${r.title}">${r.title}</a>
              </div>
              <div class="snippet">${r.snippet}</div>
            </div>
          `;
            })
            .join('')}
        </div>
      </div>
    `;
    searchContainer.innerHTML = searchHtml;
  } else if (searchResults && Array.isArray(searchResults) && searchResults.length === 0) {
    // No results found UI
    const searchHtml = `
      <div class="search-box collapsed">
        <div class="search-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span><i class="fas fa-search"></i> No sources found</span>
          <i class="fas fa-chevron-down toggle-icon"></i>
        </div>
        <div class="search-content">
          The search returned no results.
        </div>
      </div>`;
    searchContainer.innerHTML = searchHtml;
  }

  // 3. Stream
  let systemPrompt = p.prompt + ' Sei hilfreich und antworte ausführlich.';
  let history = session.messages;

  if (isThinkingMode) {
    systemPrompt +=
      ' IMPORTANT: You MUST start your response with a <think>...</think> block where you reason about the user query step-by-step before providing the final answer.';
  } else {
    systemPrompt +=
      ' IMPORTANT: You must NOT use <think> tags or output any internal thought process. Answer directly and immediately.';
    // Clean history to prevent pattern matching
    history = getCleanHistory(history);
  }

  const messages = [
    {
      role: 'system',
      content: systemPrompt,
    }, // Normal chat behavior
    ...history,
  ];

  if (searchResults && searchResults.length > 0) {
    const context = searchResults
      .map((r) => `Title: ${r.title}\nSnippet: ${r.snippet}\nLink: ${r.link}`)
      .join('\n\n');
    messages.splice(messages.length - 1, 0, {
      role: 'system',
      content: `[SEARCH RESULTS START]\n${context}\n[SEARCH RESULTS END]\n\nUse the search results above to answer the user's question if relevant.`,
    });
  }

  const startTime = Date.now();

  // Determine Model ID dynamically
  // Priority: Custom Model ID > Persona-specific ID > Global Loaded ID > Default
  const modelId = getModelIdForSession(session);

  console.log('[askSingleModel] Starting stream with Model ID:', modelId);

  if (!modelId) {
    alert('Error: Model ID is missing. Please check the console.');
    return;
  }

  await new Promise((resolve, reject) => {
    let estimatedTokens = 0;
    let currentFullText = '';

    streamResponse(
      {
        model: modelId,
        model_index: session.modelIndex || 0,
        messages: messages,
        max_tokens: -1, // Unlimited for chat
        temperature: 0.7,
      },
      (chunk, fullText) => {
        currentFullText = fullText;
        estimatedTokens++;
        // Update UI live
        updateStreamingContent(textContainer, fullText);
        headerDiv.textContent = `${fullText.length} chars | ~${estimatedTokens} tokens`;
        smartScroll();
      },
      async (finalText, usage) => {
        console.log('[askSingleModel] Stream complete. Length:', finalText.length);
        const endTime = Date.now();

        if (!usage || !usage.completion_tokens) {
          usage = {
            prompt_tokens: usage?.prompt_tokens || 0,
            completion_tokens: usage?.completion_tokens || estimatedTokens,
          };
        }

        trackUsage(usage, endTime - startTime);

        updateStreamingContent(textContainer, finalText);
        let meta = `${finalText.length} chars`;
        if (usage && usage.completion_tokens) meta += ` | ${usage.completion_tokens} tokens`;
        headerDiv.textContent = meta;

        // Update History
        session.messages.push({ role: 'assistant', content: finalText });
        await saveCurrentSession();
        scrollToBottom(true);

        // Auto-Title AFTER response is done (to avoid blocking)
        if (session.messages.length >= 2) {
          // 1 user + 1 assistant
          generateTitle(session, q);
        }

        resolve();
      },
      (err) => {
        if (err.name === 'AbortError') {
          if (!currentFullText) {
            textContainer.innerHTML = '<span style="color:red; font-size:0.8em;">[STOPPED]</span>';
          } else {
            textContainer.innerHTML +=
              ' <span style="color:red; font-size:0.8em;">[STOPPED]</span>';
          }
          reject(err);
        } else {
          if (currentFullText.length > 0) {
            textContainer.innerHTML += `<br><span style="color:red; font-weight:bold;">[Error: ${err.message}]</span>`;
          } else {
            textContainer.innerHTML = `<div style="color:red; font-weight:bold;">Error: ${err.message}</div><br><small>Check if Model ID "${modelId}" is correct and LM Studio is running.</small>`;
          }
          resolve(); // Resolve on other errors to not break app flow? Or reject?
        }
      },
      signal,
    );
  });
}

async function askCouncil(q, session, signal, searchResults = null, skipUserMsg = false) {
  if (!personas || personas.length === 0) {
    const errDiv = createMessageCard(
      'Error: No Council Members found. Please add members or reload.',
      'msg-system',
      'SYSTEM',
    );
    messagesContainer.appendChild(errDiv);
    return;
  }

  // 1. Add User Message & History
  if (!skipUserMsg) {
    const userMsg = createMessageCard(q, 'msg-user', 'USER');
    messagesContainer.appendChild(userMsg);
  }

  session.messages.push({ role: 'user', content: q });
  await saveCurrentSession();

  scrollToBottom(true);

  // --- NEW BLOCK START ---
  // Inject Search Results as a standalone card
  if (searchResults && searchResults.length > 0) {
    const searchHtml = `
      <div class="search-box collapsed">
        <div class="search-header" onclick="this.parentElement.classList.toggle('collapsed')">
          <span><i class="fas fa-globe"></i> Found ${searchResults.length} Sources</span>
          <i class="fas fa-chevron-down toggle-icon"></i>
        </div>
        <div class="search-content">
          ${searchResults
            .map((r) => {
              let domain = 'google.com';
              try {
                if (r.link) domain = new URL(r.link).hostname;
              } catch (e) {}
              const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
              return `
            <div class="search-item">
              <div class="search-item-top">
                <img src="${faviconUrl}" class="search-favicon" onerror="this.style.display='none'">
                <a href="${r.link}" target="_blank" title="${r.title}">${r.title}</a>
              </div>
              <div class="snippet">${r.snippet}</div>
            </div>
          `;
            })
            .join('')}
        </div>
      </div>`;

    const searchCard = document.createElement('div');
    searchCard.className = 'msg-card';
    searchCard.style.borderLeft = '4px solid #007acc'; // Blue for research
    searchCard.innerHTML = `
        <div class="msg-header" style="color: #007acc">
            <span>RESEARCH DATA</span>
            <span>${searchResults.length} Sources</span>
        </div>
        <div class="msg-content">
            ${searchHtml}
        </div>
      `;
    messagesContainer.appendChild(searchCard);
  }
  // --- NEW BLOCK END ---

  // 2. Create placeholders
  const placeholders = [];
  for (let i = 0; i < personas.length; i++) {
    const p = createMessageCard(getLoaderHtml(), personas[i].class, `${personas[i].name}`);
    messagesContainer.appendChild(p);
    placeholders.push(p);
  }
  scrollToBottom(true);

  const answers = new Array(personas.length).fill('');

  // 3. Fetch responses (Sequential Streaming to avoid Overload)
  try {
    for (let i = 0; i < personas.length; i++) {
      // Check if stopped before starting next
      if (signal && signal.aborted) break;

      await new Promise((resolve, reject) => {
        const card = placeholders[i];
        const contentDiv = card.querySelector('.msg-content');
        const headerDiv = card.querySelector('.msg-header span:last-child');

        // Update UI to show who is currently thinking
        card.style.opacity = '1';

        // Prepare structure for text
        contentDiv.innerHTML = '';
        const textContainer = document.createElement('div');
        textContainer.className = 'text-container';
        textContainer.innerHTML = getLoaderHtml();
        contentDiv.appendChild(textContainer);

        let systemPrompt =
          personas[i].prompt +
          ' Gib eine fundierte, aber prägnante Meinung ab. Begründe deine Ansicht kurz.';
        let history = session.messages;

        if (isThinkingMode) {
          systemPrompt +=
            ' IMPORTANT: You MUST start your response with a <think>...</think> block where you reason about the user query step-by-step before providing the final answer.';
        } else {
          systemPrompt +=
            ' IMPORTANT: You must NOT use <think> tags or output any internal thought process. Answer directly and immediately.';
          // Clean history to prevent pattern matching
          history = getCleanHistory(history);
        }

        const messages = [
          {
            role: 'system',
            content: systemPrompt,
          },
          ...history, // Contains previous Qs and Final As
        ];

        // Inject Search Context
        if (searchResults && searchResults.length > 0) {
          const context = searchResults
            .map((r) => `Title: ${r.title}\nSnippet: ${r.snippet}\nLink: ${r.link}`)
            .join('\n\n');
          messages.splice(messages.length - 1, 0, {
            role: 'system',
            content: `[SEARCH RESULTS START]\n${context}\n[SEARCH RESULTS END]\n\nUse the search results above to answer the user's question if relevant.`,
          });
        }

        const startTime = Date.now();

        // Determine Model ID dynamically
        const modelId = personas[i].modelId || window.lastLoadedModelId || 'local-model';
        let estimatedTokens = 0;
        let currentFullText = '';

        streamResponse(
          {
            model: modelId,
            model_index: i,
            messages: messages,
            max_tokens: -1,
            temperature: 0.7,
          },
          (chunk, fullText) => {
            currentFullText = fullText;
            estimatedTokens++;
            updateStreamingContent(textContainer, fullText);
            headerDiv.textContent = `${fullText.length} chars | ~${estimatedTokens} tokens`;
            smartScroll();
          },
          (finalText, usage) => {
            const endTime = Date.now();

            if (!usage || !usage.completion_tokens) {
              usage = {
                prompt_tokens: usage?.prompt_tokens || 0,
                completion_tokens: usage?.completion_tokens || estimatedTokens,
              };
            }

            trackUsage(usage, endTime - startTime);

            updateStreamingContent(textContainer, finalText);
            let meta = `${finalText.length} chars`;
            if (usage && usage.completion_tokens) meta += ` | ${usage.completion_tokens} tokens`;
            headerDiv.textContent = meta;
            answers[i] = finalText;
            resolve();
          },
          (err) => {
            if (err.name === 'AbortError') {
              textContainer.innerHTML +=
                ' <span style="color:red; font-size:0.8em;">[STOPPED]</span>';
              reject(err);
            } else {
              if (currentFullText.length > 0) {
                textContainer.innerHTML +=
                  ' <span style="color:red; font-size:0.8em;">[CONNECTION LOST]</span>';
                answers[i] = currentFullText;
              } else {
                textContainer.textContent = 'OFFLINE (Check LM Studio)';
                answers[i] = '';
              }
              resolve(); // Continue to next even if one fails
            }
          },
          signal,
        );
      }).catch((e) => {
        if (e.name === 'AbortError') throw e; // Propagate abort up
      });
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }

  // Cleanup if stopped
  if (signal && signal.aborted) {
    placeholders.forEach((card, idx) => {
      if (!answers[idx]) {
        const contentDiv = card.querySelector('.msg-content');
        contentDiv.innerHTML = '<span style="color:gray; font-style:italic;">[Stopped]</span>';
        card.style.opacity = '0.6';
      }
    });
    return;
  }

  // 4. Determine Consensus (New Logic)
  const validAnswers = answers.filter((a) => a !== '…' && a !== 'OFFLINE' && a !== '');

  // Create Consensus Placeholder
  const finalDiv = document.createElement('div');
  finalDiv.className = 'msg-card msg-final';
  finalDiv.innerHTML = `
    <div class="final-header">
      <i class="fas fa-check-circle"></i> SYSTEM CONSENSUS
    </div>
    <div class="final-body">
      ${getLoaderHtml()}
    </div>
  `;
  messagesContainer.appendChild(finalDiv);
  scrollToBottom(true);

  const consensusBody = finalDiv.querySelector('.final-body');

  if (validAnswers.length === 0) {
    consensusBody.textContent = 'Kein Konsens möglich (Keine Antworten).';
    return;
  }

  // Generate Consensus via LLM
  // Use the session's model ID for consensus to ensure consistency
  const modelId = getModelIdForSession(session);
  console.log('[askCouncil] Generating Consensus with Model ID:', modelId);

  // Clean answers to remove <think> tags to save context window
  const cleanAnswers = answers.map((a) => a.replace(/<think>[\s\S]*?<\/think>/gi, '').trim());

  const consensusPrompt = `
    Du bist der neutrale Protokollführer des AI Councils.
    Deine Aufgabe ist es, die Diskussion der Ratsmitglieder zusammenzufassen und ein Fazit zu ziehen.

    DIE FRAGE WAR: "${q}"

    HIER SIND DIE ANTWORTEN DER RATSMITGLIEDER:
    ${personas.map((p, idx) => `### ${p.name}:\n${cleanAnswers[idx]}`).join('\n\n')}

    AUFGABE:
    Erstelle einen "Consensus Report", der AUSSCHLIESSLICH auf den oben genannten Antworten basiert.
    1. Fasse die Kernargumente der verschiedenen Mitglieder zusammen. Nenne die Mitglieder beim Namen (z.B. "Der Skeptiker argumentiert...").
    2. Identifiziere Übereinstimmungen und Widersprüche zwischen den Mitgliedern.
    3. Formuliere am Ende ein klares Fazit / eine "Gewinner-Antwort", die den Konsens des Rates am besten widerspiegelt.

    WICHTIG: Füge keine eigenen Fakten hinzu, die nicht von den Mitgliedern genannt wurden. Analysiere nur das Gesagte.
  `;

  await new Promise((resolve, reject) => {
    const startTime = Date.now();
    let estimatedTokens = 0;

    // Prepare Consensus System Prompt
    let consensusSystemPrompt =
      'Du bist der Vorsitzende des AI Councils. Analysiere die Aussagen der Mitglieder.';
    if (isThinkingMode) {
      consensusSystemPrompt +=
        ' IMPORTANT: You MUST start your response with a <think>...</think> block where you reason about the user query step-by-step before providing the final answer.';
    } else {
      consensusSystemPrompt +=
        ' IMPORTANT: You must NOT use <think> tags or output any internal thought process. Answer directly and immediately.';
    }

    streamResponse(
      {
        model: modelId,
        messages: [
          {
            role: 'system',
            content: consensusSystemPrompt,
          },
          { role: 'user', content: consensusPrompt },
        ],
        max_tokens: -1, // Use -1 to allow full context usage (avoid overflow errors)
        temperature: 0.7,
      },
      (chunk, fullText) => {
        estimatedTokens++;
        updateStreamingContent(consensusBody, fullText);
        smartScroll();
      },
      (finalText, usage) => {
        const endTime = Date.now();
        if (!usage || !usage.completion_tokens) {
          usage = {
            prompt_tokens: usage?.prompt_tokens || 0,
            completion_tokens: usage?.completion_tokens || estimatedTokens,
          };
        }
        trackUsage(usage, endTime - startTime);

        updateStreamingContent(consensusBody, finalText);

        // Add Winner to History
        session.messages.push({ role: 'assistant', content: finalText, type: 'consensus' });
        saveCurrentSession(); // Use new save function

        // Auto-Title AFTER consensus
        if (session.messages.length >= 2) {
          generateTitle(session, q);
        }
        resolve();
      },
      (err) => {
        if (err.name === 'AbortError') {
          consensusBody.innerHTML += ' <span style="color:red">[STOPPED]</span>';
          reject(err);
        } else {
          consensusBody.textContent = 'Fehler bei der Konsens-Findung: ' + err.message;
          // Even if consensus fails, try to title the chat so it's not stuck as "New Chat"
          if (session.messages.length >= 1) {
            generateTitle(session, q);
          }
          resolve();
        }
      },
      signal,
    );
  });

  scrollToBottom(true);
}

input.addEventListener('keydown', (e) => e.key === 'Enter' && handleInput());

// --- SIDEBAR EVENTS ---
// Removed old listener as it is now handled dynamically in renderSessionList
