export const IDE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hybrid IDE - Production ($0/month)</title>
  <!-- VS Code Icons -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@vscode/codicons/dist/codicon.css" />
  <style>
    :root {
      --bg-color: #1e1e1e;
      --sidebar-bg: #252526;
      --activity-bar-bg: #333333;
      --status-bar-bg: #007acc;
      --border-color: #3e3e42;
      --text-color: #cccccc;
      --accent-color: #007acc;
      --hover-bg: #2a2d2e;
      --input-bg: #3c3c3c;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; height: 100vh; overflow: hidden; background: var(--bg-color); color: var(--text-color); display: flex; flex-direction: column; }

    .main-layout { display: flex; flex-grow: 1; overflow: hidden; }

    /* Activity Bar */
    .activity-bar { width: 48px; background: var(--activity-bar-bg); display: flex; flex-direction: column; align-items: center; padding-top: 10px; }
    .activity-icon { color: #858585; font-size: 24px; margin-bottom: 25px; cursor: pointer; position: relative; }
    .activity-icon.active { color: white; border-left: 2px solid white; }
    .activity-icon:hover { color: white; }

    /* Sidebar */
    .sidebar { width: 250px; background: var(--sidebar-bg); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; }
    .sidebar-header { padding: 10px 20px; font-size: 11px; font-weight: bold; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center; }
    .file-tree { flex-grow: 1; padding-top: 5px; }
    .file-item { padding: 3px 20px; cursor: pointer; display: flex; align-items: center; font-size: 13px; color: #cccccc; }
    .file-item:hover { background: var(--hover-bg); }
    .file-item.active { background: #37373d; color: white; }
    .file-icon { margin-right: 6px; font-size: 14px; }

    /* Editor Area */
    .editor-area { flex-grow: 1; display: flex; flex-direction: column; background: var(--bg-color); }
    .tabs-container { display: flex; background: var(--sidebar-bg); height: 35px; border-bottom: 1px solid var(--border-color); overflow-x: auto; }
    .tab { padding: 8px 15px; font-size: 13px; color: #969696; background: #2d2d2d; border-right: 1px solid var(--border-color); cursor: pointer; display: flex; align-items: center; min-width: 120px; }
    .tab.active { background: var(--bg-color); color: white; border-top: 1px solid var(--accent-color); }
    .tab-close { margin-left: auto; font-size: 12px; margin-left: 10px; opacity: 0; }
    .tab:hover .tab-close { opacity: 1; }

    #editor { flex-grow: 1; }

    /* Status Bar */
    .status-bar { height: 22px; background: var(--status-bar-bg); color: white; display: flex; align-items: center; padding: 0 10px; font-size: 12px; justify-content: space-between; }
    .status-item { margin-right: 15px; display: flex; align-items: center; cursor: pointer; }
    .status-item i { margin-right: 5px; }
    .quota-warning { background: #c72e0f !important; }

    /* Toast Notifications */
    .toast-container { position: fixed; bottom: 30px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 1000; }
    .toast { background: #333; color: white; padding: 12px 20px; border-radius: 4px; border-left: 4px solid #007acc; box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-size: 13px; animation: slideIn 0.3s ease; display: flex; align-items: center; min-width: 250px; }
    .toast.success { border-left-color: #4caf50; }
    .toast.error { border-left-color: #f44336; }
    .toast.info { border-left-color: #007acc; }
    .toast.loading { border-left-color: #e8c65f; }
    .toast i { margin-right: 10px; font-size: 16px; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }

    /* Modal */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; display: none; justify-content: center; align-items: center; }
    .modal { background: #252526; width: 600px; max-width: 90%; max-height: 80vh; border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); display: flex; flex-direction: column; border: 1px solid var(--border-color); }
    .modal-header { padding: 15px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; font-weight: bold; }
    .modal-body { padding: 20px; overflow-y: auto; font-family: 'Consolas', monospace; white-space: pre-wrap; line-height: 1.5; font-size: 13px; color: #d4d4d4; }
    .modal-close { cursor: pointer; font-size: 16px; }
    .modal-close:hover { color: white; }

  </style>
</head>
<body>
  <div class="main-layout">
    <!-- Activity Bar -->
    <div class="activity-bar">
      <div class="activity-icon active" title="Explorer" id="act-explorer" onclick="switchView('explorer')"><i class="codicon codicon-files"></i></div>
      <div class="activity-icon" title="Search" id="act-search" onclick="switchView('search')"><i class="codicon codicon-search"></i></div>
      <div class="activity-icon" title="Source Control" id="act-scm" onclick="switchView('scm')"><i class="codicon codicon-source-control"></i></div>
      <div class="activity-icon" title="Run and Debug" id="act-debug" onclick="switchView('debug')"><i class="codicon codicon-debug-alt"></i></div>
      <div class="activity-icon" title="Extensions" id="act-extensions" onclick="switchView('extensions')"><i class="codicon codicon-extensions"></i></div>
      <div style="flex-grow: 1;"></div>
      <div class="activity-icon" title="Accounts"><i class="codicon codicon-account"></i></div>
      <div class="activity-icon" title="Settings"><i class="codicon codicon-settings-gear"></i></div>
    </div>

    <!-- Sidebar -->
    <div class="sidebar">
      <div class="sidebar-header">
        <span id="sidebar-title">Explorer</span>
        <i class="codicon codicon-ellipsis"></i>
      </div>
      <div style="padding: 10px 20px; font-weight: bold; font-size: 11px; display: flex; align-items: center;">
        <i class="codicon codicon-chevron-down" style="margin-right: 5px;"></i> HYBRID-IDE-PROJECT
      </div>

      <!-- Explorer View -->
      <div id="view-explorer" class="file-tree" style="display: block;">
         <div id="file-tree"></div>
      </div>

      <!-- Placeholder Views -->
      <div id="view-search" style="display: none; padding: 20px; font-size: 12px; color: #858585;">Search not implemented</div>
      <div id="view-scm" style="display: none; padding: 20px; font-size: 12px; color: #858585;">No changes detected</div>
      <div id="view-debug" style="display: none; padding: 20px; font-size: 12px; color: #858585;">Debug configuration missing</div>
      <div id="view-extensions" style="display: none; padding: 20px; font-size: 12px; color: #858585;">No extensions installed</div>

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
        const data = await res.json();
        files[filename].content = data.content;

        if (activeFile === filename && editor) {
          editor.setValue(data.content);
          monaco.editor.setModelLanguage(editor.getModel(), files[filename].language);
        }
      } catch (e) {
        showToast('Failed to load content', 'error');
      }
    }

    async function saveCurrentFile() {
       if (!activeFile) return;
       const content = editor.getValue();
       files[activeFile].content = content;

       const statusDiv = document.getElementById('provider');
       statusDiv.textContent = 'Saving...';

       try {
         const res = await fetch('/api/fs/file', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ name: activeFile, content })
         });

         if (res.ok) {
           statusDiv.textContent = 'Ready';
           showToast('File saved to Cloud!', 'success');
         } else {
           throw new Error('Save failed');
         }
       } catch (e) {
         statusDiv.textContent = 'Save Error';
         showToast('Failed to save file', 'error');
       }
    }

    function renderUI() {
      const tree = document.getElementById('file-tree');
      const tabs = document.getElementById('tabs-container');

      tree.innerHTML = '';
      tabs.innerHTML = '';

      Object.keys(files).forEach(filename => {
        const file = files[filename];
        const isActive = filename === activeFile;

        // Sidebar Item
        const item = document.createElement('div');
        item.className = \`file-item \${isActive ? 'active' : ''}\`;
        item.onclick = () => switchFile(filename);
        item.innerHTML = \`<i class="codicon \${file.icon} file-icon" style="color: \${file.color};"></i> \${filename}\`;
        tree.appendChild(item);

        // Tab Item
        if (isActive) {
             const tab = document.createElement('div');
             tab.className = \`tab \${isActive ? 'active' : ''}\`;
             tab.onclick = () => switchFile(filename);
             tab.innerHTML = \`
               <i class="codicon \${file.icon}" style="color: \${file.color}; margin-right: 6px; font-size: 14px;"></i>
               \${filename}
               <span class="tab-close"><i class="codicon codicon-close"></i></span>
             \`;
             tabs.appendChild(tab);

             document.getElementById('lang-status').textContent = file.language;
        }
      });
    }

    function switchFile(filename) {
      if (activeFile === filename) return;

      // Save current editor state to local cache before switching
      if (editor && activeFile && files[activeFile] && files[activeFile].content !== null) {
        files[activeFile].content = editor.getValue();
      }

      activeFile = filename;
      const file = files[activeFile];

      // If content is missing, load it
      if (file.content === null) {
         if (editor) editor.setValue('Loading...');
         loadFileContent(filename);
      } else {
         if (editor) {
            editor.setValue(file.content);
            monaco.editor.setModelLanguage(editor.getModel(), file.language);
         }
      }

      renderUI();
    }

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
      });
    }

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
         const response = await fetch('/api/complete', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
             code: content,
             cursor,
             language: files[activeFile]?.language || 'plaintext',
             fileId: activeFile
           })
         });

         if (!response.ok) throw new Error('API Failed');

         const reader = response.body.getReader();
         const decoder = new TextDecoder();
         let result = '', provider = '';

         while (true) {
           const { done, value } = await reader.read();
           if (done) break;
           const chunk = decoder.decode(value);
           const lines = chunk.split('\\n');
           for (const line of lines) {
             if (line.startsWith('data: ')) {
               const data = JSON.parse(line.slice(6));
               result = data.token; // Update result
               provider = data.provider;
             }
           }
         }

         if (result) {
            editor.executeEdits('ai', [{
                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                text: result,
                forceMoveMarkers: true
            }]);

            toast.remove(); // Remove loading toast
            showToast(\`AI Completed (\${provider})\`, "success");
            updateQuota();
         }
       } catch (e) {
         toast.remove();
         showToast('AI Completion Failed', 'error');
       }
    }

    async function explainCode() {
        if (!editor) return;
        const selection = editor.getModel().getValueInRange(editor.getSelection());

        if(!selection) {
            showToast('Please select code to explain', 'info');
            return;
        }

        const toast = showToast("AI is analyzing...", "loading");

        try {
            const response = await fetch('/api/explain', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: selection, language: files[activeFile]?.language || 'plaintext' })
            });

            const data = await response.json();
            toast.remove();

            if (data.explanation) {
                openModal(\`AI Explanation (\${data.provider})\`, data.explanation);
            } else {
                showToast('No explanation returned', 'error');
            }
        } catch(e) {
            toast.remove();
            showToast('AI Explanation Failed', 'error');
        }
    }

    // Ctrl+S prevention and SAVE to R2
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveCurrentFile();
        }
    });
  </script>
</body>
</html>`;
