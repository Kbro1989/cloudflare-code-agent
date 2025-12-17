
export const IDE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hybrid IDE</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codicon/0.0.32/codicon.min.css" />
  <style>
    :root {
      --bg-color: #1e1e1e;
      --sidebar-bg: #252526;
      --border-color: #3e3e42;
      --accent-color: #007acc;
      --text-color: #cccccc;
      --activity-bar-bg: #333333;
    }
    body { margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: var(--bg-color); color: var(--text-color); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

    /* Layout */
    .header { height: 35px; background: #3c3c3c; display: flex; align-items: center; padding: 0 10px; font-size: 13px; font-weight: 500; -webkit-app-region: drag; }
    .main-container { display: flex; flex: 1; overflow: hidden; }
    .activity-bar { width: 48px; background: var(--activity-bar-bg); display: flex; flex-direction: column; align-items: center; padding-top: 10px; z-index: 10; }
    .activity-icon { width: 48px; height: 48px; display: flex; justify-content: center; align-items: center; cursor: pointer; color: #858585; font-size: 24px; position: relative; }
    .activity-icon:hover { color: white; }
    .activity-icon.active { color: white; border-left: 2px solid white; }

    .sidebar { width: 250px; background: var(--sidebar-bg); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; }
    .sidebar-header { padding: 10px 20px; font-size: 11px; text-transform: uppercase; font-weight: bold; display: flex; justify-content: space-between; align-items: center; }

    .editor-area { flex: 1; display: flex; flex-direction: column; background: var(--bg-color); }
    .tabs-container { display: flex; background: var(--sidebar-bg); height: 35px; align-items: center; overflow-x: auto; }
    .tab { padding: 8px 15px; color: #969696; background: #2d2d2d; border-right: 1px solid #1e1e1e; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px; user-select: none; }
    .tab.active { background: #1e1e1e; color: white; border-top: 1px solid var(--accent-color); }
    .tab:hover { background: #1e1e1e; }
    .tab-close { opacity: 0; margin-left: 5px; font-size: 12px; }
    .tab:hover .tab-close { opacity: 1; }

    #editor { flex: 1; width: 100%; }

    /* File Tree */
    .file-tree { padding: 5px 0; overflow-y: auto; flex: 1; }
    .file-item { padding: 3px 20px; cursor: pointer; font-size: 13px; color: #cccccc; display: flex; align-items: center; gap: 6px; }
    .file-item:hover { background: #2a2d2e; }
    .file-item.active { background: #37373d; color: white; }
    .folder-item { padding: 3px 10px; font-weight: bold; font-size: 12px; color: #bbbbbb; margin-top: 5px; }

    /* Status Bar */
    .status-bar { height: 22px; background: #007acc; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; font-size: 12px; color: white; z-index: 20; }
    .status-item { display: flex; align-items: center; gap: 5px; margin-right: 15px; cursor: pointer; }
    .status-bar.quota-warning { background: #e51400; }

    /* Toast */
    .toast-container { position: fixed; bottom: 40px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 1000; }
    .toast { background: #252526; color: white; padding: 12px 20px; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 10px; font-size: 13px; animation: slideIn 0.3s ease-out; border-left: 3px solid var(--accent-color); min-width: 200px; }
    .toast.error { border-left-color: #f44336; }
    .toast.success { border-left-color: #4caf50; }
    .toast.loading { border-left-color: #2196f3; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeOut { to { transform: translateY(10px); opacity: 0; } }

    /* Modals */
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: none; justify-content: center; align-items: center; z-index: 2000; }
    .modal { background: #252526; width: 600px; max-width: 90%; max-height: 80vh; display: flex; flex-direction: column; border-radius: 6px; box-shadow: 0 0 20px rgba(0,0,0,0.5); border: 1px solid var(--border-color); }
    .modal-header { padding: 10px 20px; background: #333333; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
    .modal-body { padding: 20px; overflow-y: auto; font-family: 'Consolas', monospace; white-space: pre-wrap; line-height: 1.5; font-size: 13px; }
    .modal-close { cursor: pointer; }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div style="margin-right: 15px;">Hybrid IDE</div>
    <div style="color: #999; font-size: 12px;">File Edit Selection View Go Run Terminal Help</div>
  </div>

  <div class="main-container">
    <!-- Activity Bar -->
    <div class="activity-bar">
      <div class="activity-icon active" id="act-explorer" onclick="switchView('explorer')"><i class="codicon codicon-files"></i></div>
      <div class="activity-icon" id="act-search" onclick="switchView('search')"><i class="codicon codicon-search"></i></div>
      <div class="activity-icon" id="act-scm" onclick="switchView('scm')"><i class="codicon codicon-source-control"></i></div>
      <div class="activity-icon" id="act-debug" onclick="switchView('debug')"><i class="codicon codicon-debug-alt"></i></div>
      <div class="activity-icon" id="act-extensions" onclick="switchView('extensions')"><i class="codicon codicon-extensions"></i></div>
      <div class="activity-icon" style="margin-top: auto; margin-bottom: 10px;"><i class="codicon codicon-account"></i></div>
      <div class="activity-icon" style="margin-bottom: 10px;"><i class="codicon codicon-settings-gear"></i></div>
    </div>

    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-header">
        <span id="sidebar-title">EXPLORER</span>
        <div style="display: flex; gap: 10px;">
          <i class="codicon codicon-new-file" style="cursor: pointer;" title="New File" onclick="createNewFile()"></i>
          <i class="codicon codicon-collapse-all"></i>
        </div>
      </div>

      <!-- Explorer View -->
      <div id="view-explorer" class="file-tree" style="display: block;">
         <div id="file-tree"></div>
      </div>

      <!-- Placeholder Views -->
      <div id="view-search" style="display: none; padding: 20px; font-size: 12px; color: #858585;">Search not implemented</div>
      <div id="view-scm" style="display: none; padding: 20px; font-size: 12px; color: #858585;">No changes detected</div>
      <div id="view-debug" style="display: none; padding: 20px; font-size: 12px; color: #858585;">Debug configuration missing</div>

      <!-- Chat View -->
      <div id="view-extensions" style="display: none; padding: 0; display: flex; flex-direction: column; height: 100%;">
          <div id="chat-messages" style="flex-grow: 1; padding: 15px; overflow-y: auto; font-size: 13px; display: flex; flex-direction: column; gap: 15px;">
              <div style="background: #2d2d2d; padding: 10px; border-radius: 4px; color: #d4d4d4;">
                  <i class="codicon codicon-hubot" style="margin-right: 5px;"></i> Hello! I'm your AI coding assistant. How can I help you?
              </div>
          </div>
          <div style="padding: 10px; border-top: 1px solid var(--border-color); background: var(--sidebar-bg);">
              <textarea id="chat-input" placeholder="Ask a question..." style="width: 100%; height: 60px; background: #3c3c3c; border: 1px solid var(--border-color); color: white; padding: 8px; font-family: inherit; font-size: 12px; resize: none; border-radius: 2px;"></textarea>
              <div style="display: flex; justify-content: flex-end; margin-top: 5px;">
                  <button onclick="sendChatMessage()" style="background: var(--accent-color); color: white; border: none; padding: 4px 12px; font-size: 11px; cursor: pointer; border-radius: 2px;">Send <i class="codicon codicon-send"></i></button>
              </div>
          </div>
      </div>

      <!-- Stats / Quota Area -->
       <div style="margin-top: auto; padding: 15px; border-top: 1px solid var(--border-color);">
        <div style="font-size: 11px; color: #858585; margin-bottom: 5px; text-transform: uppercase;">Usage Statistics</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-size: 12px;">
          <span>KV Writes</span>
          <span id="quotaDisplay" style="color: #4caf50;">0%</span>
        </div>
        <div style="width: 100%; height: 4px; background: #3c3c3c; border-radius: 2px;">
          <div id="quotaBar" style="width: 0%; height: 100%; background: #4caf50; border-radius: 2px;"></div>
        </div>
      </div>
    </div>

    <!-- Main Editor Area -->
    <div class="editor-area">
      <!-- Tabs -->
      <div class="tabs-container" id="tabs-container">
        <!-- Tabs injected here -->
      </div>

      <!-- Monaco Editor -->
      <div id="editor"></div>
    </div>
  </div>

  <!-- Status Bar -->
  <div class="status-bar" id="statusBar">
    <div style="display: flex;">
      <div class="status-item"><i class="codicon codicon-remote"></i> Production</div>
      <div class="status-item"><i class="codicon codicon-git-branch"></i> main*</div>
      <div class="status-item"><i class="codicon codicon-error"></i> 0 <i class="codicon codicon-warning" style="margin-left: 5px;"></i> 0</div>
    </div>
    <div style="display: flex;">
         <div class="status-item" id="provider">Waiting...</div>
         <div class="status-item" id="cursor-position">Ln 1, Col 1</div>
         <div class="status-item">UTF-8</div>
         <div class="status-item" id="lang-status">TypeScript</div>
         <div class="status-item"><i class="codicon codicon-bell"></i></div>
    </div>
  </div>

  <!-- Toasts -->
  <div class="toast-container" id="toastContainer"></div>

  <!-- Modal -->
  <div class="modal-overlay" id="modalOverlay">
    <div class="modal">
      <div class="modal-header">
        <span id="modalTitle">AI Explanation</span>
        <i class="codicon codicon-close modal-close" onclick="closeModal()"></i>
      </div>
      <div class="modal-body" id="modalContent"></div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js"></script>
  <script>
    let editor;
    let files = {};
    let activeFile = '';

    // Initialize UI
    async function init() {
      await loadFiles();
      renderUI();
      if (activeFile) loadFileContent(activeFile);
    }

    // Toast Function
    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = \`toast \${type}\`;

      let icon = 'codicon-info';
      if(type === 'success') icon = 'codicon-check';
      if(type === 'error') icon = 'codicon-error';
      if(type === 'loading') icon = 'codicon-loading codicon-modifier-spin';

      toast.innerHTML = \`<i class="codicon \${icon}"></i> \${message}\`;
      container.appendChild(toast);

      // Auto remove after 3s (unless loading)
      if (type !== 'loading') {
          setTimeout(() => {
              toast.style.animation = 'fadeOut 0.3s forwards';
              setTimeout(() => toast.remove(), 300);
          }, 4000);
      }
      return toast;
    }

    // Modal Functions
    function openModal(title, content) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalContent').textContent = content;
        document.getElementById('modalOverlay').style.display = 'flex';
    }

    window.closeModal = function() {
        document.getElementById('modalOverlay').style.display = 'none';
    };

    async function loadFiles() {
      try {
        const res = await fetch('/api/fs/list');
        const list = await res.json();

        files = {}; // Reset
        list.forEach(f => {
          const ext = f.name.split('.').pop();
          let icon = 'codicon-file';
          let color = '#cccccc';
          let lang = 'plaintext';

          if (ext === 'ts' || ext === 'js') { icon = 'codicon-file-code'; color = '#4fc1ff'; lang = 'typescript'; }
          if (ext === 'json') { icon = 'codicon-file-code'; color = '#e8c65f'; lang = 'json'; }
          if (ext === 'md') { icon = 'codicon-file-media'; color = '#cccccc'; lang = 'markdown'; }
          if (ext === 'toml') { icon = 'codicon-gear'; color = '#cccccc'; lang = 'toml'; }

          files[f.name] = {
            content: null, // Load on demand
            language: lang,
            icon: icon,
            color: color
          };
        });

        if (!activeFile && list.length > 0) activeFile = list[0].name;
      } catch (e) {
        showToast('Failed to list files', 'error');
        console.error('Failed to list files', e);
      }
    }

    async function loadFileContent(filename) {
      if (!files[filename]) return;
      if (files[filename].content !== null) return; // Already loaded

      try {
        const res = await fetch(\`/api/fs/file?name=\${filename}\`);
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        files[filename].content = data.content;

        if (activeFile === filename) {
          if (editor) {
             editor.setValue(data.content);
             monaco.editor.setModelLanguage(editor.getModel(), files[filename].language);
          }
        }
      } catch (e) {
        showToast(\`Error loading \${filename}\`, 'error');
      }
    }

    async function saveFile() {
      if (!activeFile || !editor) return;

      const content = editor.getValue();
      files[activeFile].content = content; // Update local cache

      showToast('Saving...', 'loading');

      try {
        const res = await fetch('/api/fs/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: activeFile, content })
        });

        if (res.ok) {
           showToast('File saved!', 'success');
        } else {
           showToast('Failed to save', 'error');
        }
      } catch (e) {
         showToast('Error saving file', 'error');
      }
    }

    async function createNewFile() {
      const name = prompt("Enter file name (e.g. test.ts):");
      if (!name) return;

      files[name] = { content: '', language: 'plaintext', icon: 'codicon-file', color: '#ccc' };
      activeFile = name;
      renderUI();

      if (editor) {
          editor.setValue('');
          monaco.editor.setModelLanguage(editor.getModel(), 'plaintext');
      }

      // Save empty file to persist it to R2
      await fetch('/api/fs/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content: '' })
      });
    }

    function renderUI() {
      // Render File Tree
      const tree = document.getElementById('file-tree');
      tree.innerHTML = '';

      Object.keys(files).forEach(name => {
         const f = files[name];
         const el = document.createElement('div');
         el.className = \`file-item \${name === activeFile ? 'active' : ''}\`;
         el.innerHTML = \`<i class="codicon \${f.icon}" style="color: \${f.color}"></i> \${name}\`;
         el.onclick = () => {
           activeFile = name;
           renderUI();
           loadFileContent(name);
         };
         tree.appendChild(el);
      });

      // Render Tabs
      const tabs = document.getElementById('tabs-container');
      tabs.innerHTML = '';

      // For now just show active file as a tab
      if (activeFile) {
        const tab = document.createElement('div');
        tab.className = 'tab active';
        tab.innerHTML = \`
          <i class="codicon \${files[activeFile].icon}" style="color: \${files[activeFile].color}"></i>
          \${activeFile}
          <i class="codicon codicon-close tab-close"></i>
        \`;
        tabs.appendChild(tab);
      }
    }

    // Keybindings
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    });

    // Activity Bar Switching
    function switchView(viewName) {
      // Update Activity Bar Icons
      document.querySelectorAll('.activity-icon').forEach(el => el.classList.remove('active'));
      const activeIcon = document.getElementById(\`act-\${viewName}\`);
      if(activeIcon) activeIcon.classList.add('active');

      // Update Sidebar Title
      const titles = {
        'explorer': 'Explorer',
        'search': 'Search',
        'scm': 'Source Control',
        'debug': 'Run and Debug',
        'extensions': 'Extensions'
      };
      const titleEl = document.getElementById('sidebar-title');
      if(titleEl) titleEl.textContent = titles[viewName] || 'Sidebar';

      // Toggle Views
      ['explorer', 'search', 'scm', 'debug', 'extensions'].forEach(v => {
        const el = document.getElementById(\`view-\${v}\`);
        if(el) el.style.display = (v === viewName) ? 'block' : 'none';
        // Special flex layout for chat
        if (v === 'extensions' && viewName === 'extensions') el.style.display = 'flex';
      });
    }

    // Chat Functions
    let chatHistory = [];
    window.sendChatMessage = async function() {
        console.log('Sending chat message...');
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        if (!message) return;

        // User Message
        const chatContainer = document.getElementById('chat-messages');
        const userMsg = document.createElement('div');
        userMsg.style.cssText = 'background: #0e639c; color: white; padding: 10px; border-radius: 4px; align-self: flex-end; max-width: 90%;';
        userMsg.innerText = message;
        chatContainer.appendChild(userMsg);

        input.value = '';
        chatHistory.push({ role: 'user', content: message });

        // AI Placeholder
        const aiMsg = document.createElement('div');
        aiMsg.style.cssText = 'background: #2d2d2d; padding: 10px; border-radius: 4px; color: #d4d4d4; max-width: 90%; align-self: flex-start;';
        aiMsg.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i> Thinking...';
        chatContainer.appendChild(aiMsg);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, history: chatHistory })
            });

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let fullReply = '';
            aiMsg.innerHTML = '<i class="codicon codicon-hubot" style="margin-right: 5px;"></i> ';
            const contentSpan = document.createElement('span');
            aiMsg.appendChild(contentSpan);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\\n'); // Standard newline splitting

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.token) {
                                fullReply += data.token;
                                contentSpan.textContent += data.token; // Append only new text
                                // Throttle scroll to every ~100 chars or use requestAnimationFrame?
                                // For now, just append. Scroll is cheap if content grows at bottom.
                                chatContainer.scrollTop = chatContainer.scrollHeight;
                            }
                        } catch (e) {}
                    }
                }
            }
            chatHistory.push({ role: 'assistant', content: fullReply });

            // Tool Execution Logic (Web Version)
            // Tool Execution Logic (Web Version)
            const toolRegex = new RegExp('```json\\\\s* (\\\\{ [\\\\s\\\\S] *? "tool"[\\\\s\\\\S]*?\\\\ }) \\\\s * ```');
            const match = fullReply.match(toolRegex);

            if (match) {
                try {
                    const toolCall = JSON.parse(match[1]);
                    const { tool, args } = toolCall;

                    // Show confirmation in UI (Simple alert for now, or append a button)
                    // For Web UI, we can just append a 'Execute Tool?' button or auto-run for safe tools?
                    // Let's mimic CLI: Ask.

                    const toolMsg = document.createElement('div');
                    toolMsg.style.cssText = 'background: #2d2d2d; padding: 10px; border-radius: 4px; color: #d4d4d4; max-width: 90%; align-self: flex-start; margin-top: 5px; border: 1px solid #0e639c;';
                    toolMsg.innerHTML = \`
                        <div><strong>🛠️ Tool Request:</strong> \${tool}</div>
                        <pre style="font-size: 11px; color: #858585;">\${JSON.stringify(args, null, 2)}</pre>
                        <button id="exec-\${Date.now()}" style="margin-top:5px;">Execute</button>
                    \`;
                    chatContainer.appendChild(toolMsg);
                    chatContainer.scrollTop = chatContainer.scrollHeight;

                    const btn = toolMsg.querySelector('button');
                    btn.onclick = async () => {
                        btn.disabled = true;
                        btn.innerText = 'Executing...';
                        let toolOutput = '';

                        try {
                            if (tool === 'readFile') {
                                const fRes = await fetch(\`/api/fs/file?name=\${args.path}\`);
                                if (!fRes.ok) throw new Error(await fRes.text());
                                const fData = await fRes.json();
                                toolOutput = fData.content;
                            } else if (tool === 'writeFile') {
                                const fRes = await fetch('/api/fs/file', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ name: args.path, content: args.content })
                                });
                                if (!fRes.ok) throw new Error(await fRes.text());
                                toolOutput = \`Write to \${args.path} success\`;
                                // Refresh file list if side bar is open?
                                loadFiles();
                            } else if (tool === 'listFiles') {
                                const fRes = await fetch('/api/fs/list');
                                if (!fRes.ok) throw new Error(await fRes.text());
                                const fData = await fRes.json();
                                toolOutput = fData.map(f => f.name).join('\\n');
                            } else if (tool === 'runCommand') {
                                toolOutput = "Command execution is not supported in the Web UI. Please use the CLI for shell commands.";
                            } else {
                                toolOutput = "Unknown tool";
                            }

                            btn.innerText = 'Executed';

                            // Send result back to AI
                            chatHistory.push({ role: 'user', content: \`Tool Output for \${tool}:\\n\${toolOutput}\` });

                            // Trigger AI again (Recursion)
                            // We call sendChatMessage but we need to inject the prompt without UI?
                            // No, handleChat expects 'message' and 'history'.
                            // If we pass an empty message but updated history, it should work?
                            // Or better: Just allow the user to see the output and type "Thanks" or "Next".
                            // For true agentic loop, we should auto-call.
                            // Let's update UI with output and let user prompt for now to avoid loops.

                            const outMsg = document.createElement('div');
                            outMsg.style.cssText = 'background: #252526; color: #aaa; padding: 5px; font-family: monospace; font-size: 11px; margin-top: 5px; white-space: pre-wrap;';
                            outMsg.innerText = \`> Tool Output:\n\${toolOutput.substring(0, 200) + (toolOutput.length > 200 ? '...' : '')}\`;
                            chatContainer.appendChild(outMsg);
                             chatContainer.scrollTop = chatContainer.scrollHeight;

                        } catch (e) {
                            btn.innerText = 'Failed';
                            alert('Tool failed: ' + e.message);
                        }
                    };
                } catch(e) {
                    console.error('Tool parse error', e);
                }
            }

        } catch (e) {
            aiMsg.innerText = 'Error: ' + e.message;
            aiMsg.style.color = '#f44336';
        }
    }

    // Handle Enter in Chat Input
    document.getElementById('chat-input')?.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    // Monaco Init
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' }});
    require(['vs/editor/editor.main'], function () {
      editor = monaco.editor.create(document.getElementById('editor'), {
        value: '// Loading...',
        language: 'plaintext',
        theme: 'vs-dark',
        fontSize: 14,
        fontFamily: "'Consolas', 'Courier New', monospace",
        automaticLayout: true,
        minimap: { enabled: true },
        scrollbar: { verticalScrollbarSize: 10 },
        padding: { top: 15 }
      });

      // Sync cursor
      editor.onDidChangeCursorPosition((e) => {
        document.getElementById('cursor-position').textContent = \`Ln \${e.position.lineNumber}, Col \${e.position.column}\`;
      });

      // AI Actions
      editor.addAction({
        id: 'ai-complete',
        label: 'AI: Complete Code',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
        run: function(ed) { completeCode(); }
      });

      editor.addAction({
        id: 'ai-explain',
        label: 'AI: Explain Code',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
        run: function(ed) { explainCode(); }
      });

      // Start
      init();
    });

    // Update quota display
    async function updateQuota() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        const quota = data.kvWriteQuota || 0;

        document.getElementById('quotaDisplay').textContent = \`\${quota}% used\`;
        document.getElementById('quotaBar').style.width = \`\${quota}%\`;

        const color = quota > 85 ? '#f44336' : quota > 70 ? '#ff9800' : '#4caf50';
        document.getElementById('quotaDisplay').style.color = color;
        document.getElementById('quotaBar').style.background = color;

        if (quota >= 100) {
          document.getElementById('statusBar').className = 'status-bar quota-warning';
        }
      } catch (e) {
        document.getElementById('quotaDisplay').textContent = 'Error';
      }
    }

    updateQuota();
    setInterval(updateQuota, 30000);

    // AI Functions
    async function completeCode() {
       if (!editor) return;
       const content = editor.getValue();
       const position = editor.getPosition();
       const cursor = editor.getModel().getOffsetAt(position);

       const toast = showToast("AI is thinking...", "loading");

       try {
         const fileId = activeFile;
         const prompt = null; // Auto

         const res = await fetch('/api/complete', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ fileId, code: content, cursor, language: 'typescript', prompt })
         });

         toast.remove();

         if (res.ok) {
           const reader = res.body.getReader();
           const decoder = new TextDecoder();
           let fullCompletion = '';

           while(true) {
             const { done, value } = await reader.read();
             if (done) break;
             const chunk = decoder.decode(value, { stream: true });
             const lines = chunk.split('\\n'); // Handle streaming lines

             for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.token) fullCompletion += data.token;
                    // Provide real-time provider status
                    document.getElementById('provider').textContent = data.provider || 'AI';
                  } catch(e) {}
                }
             }
           }

           // Insert at cursor
           if (fullCompletion) {
             const op = { range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: fullCompletion };
             editor.executeEdits("ai-completion", [op]);
           }

         } else {
           showToast("AI failed to complete", "error");
         }

       } catch (e) {
         toast.remove();
         showToast("Network error", "error");
       }
    }

    async function explainCode() {
      if (!editor) return;
      const selection = editor.getSelection();
      const code = editor.getModel().getValueInRange(selection);
      if (!code) { showToast("Select code to explain", "error"); return; }

      const toast = showToast("Analyzing...", "loading");

      try {
        const res = await fetch('/api/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, language: 'typescript' })
        });

        toast.remove();
        const data = await res.json();

        openModal("AI Explanation", data.explanation);

      } catch (e) {
        toast.remove();
        showToast("Failed to explain", "error");
      }
    }
  </script>
</body>
</html>`;
