export const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Cloudflare Code Agent | IDE</title>
    <style>
        :root {
            --bg-root: #0d1117;
            --bg-sidebar: #010409;
            --bg-editor: #0d1117;
            --bg-panel: #161b22;
            --border: #30363d;
            --accent: #238636;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
        }
        * { box-sizing: border-box; }
        body { margin: 0; display: flex; height: 100vh; background: var(--bg-root); color: var(--text-primary); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; overflow: hidden; }
        
        .sidebar { width: 250px; background: var(--bg-sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        .sidebar-header { padding: 10px; font-weight: bold; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .file-list { flex: 1; overflow-y: auto; padding: 5px; }
        .file-item { padding: 8px 10px; cursor: pointer; display: flex; align-items: center; gap: 5px; border-radius: 4px; color: var(--text-secondary); }
        .file-item:hover { background: #21262d; color: var(--text-primary); }
        .file-item.active { background: #21262d; color: #fff; border-left: 3px solid #f78166; }
        
        .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .tabs { display: flex; background: var(--bg-sidebar); border-bottom: 1px solid var(--border); overflow-x: auto; }
        .tab { padding: 10px 15px; cursor: pointer; border-right: 1px solid var(--border); background: var(--bg-sidebar); display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .tab.active { background: var(--bg-editor); border-top: 2px solid #f78166; }
        .tab-close { opacity: 0.6; font-size: 16px; margin-left: 5px; }
        .tab-close:hover { opacity: 1; }
        
        #editor-container { flex: 1; position: relative; }
        
        .chat-panel { width: 400px; background: var(--bg-panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; }
        .chat-header { padding: 10px; font-weight: bold; border-bottom: 1px solid var(--border); }
        .chat-history { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 15px; }
        .message { font-size: 14px; line-height: 1.5; padding: 10px; border-radius: 6px; max-width: 90%; }
        .message.user { align-self: flex-end; background: #1f6feb; color: white; }
        .message.assistant { align-self: flex-start; background: #21262d; border: 1px solid var(--border); }
        .chat-input-area { padding: 15px; border-top: 1px solid var(--border); background: var(--bg-sidebar); }
        textarea { width: 100%; background: #0d1117; border: 1px solid var(--border); color: #fff; padding: 10px; border-radius: 6px; resize: none; font-family: inherit; }
        
        .btn { background: var(--accent); color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
        .btn:disabled { opacity: 0.5; }
        .btn:hover:not(:disabled) { opacity: 0.9; }
        
        .markdown-body pre { background: #161b22; padding: 10px; border-radius: 6px; overflow-x: auto; }
        .markdown-body code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 85%; }

        /* Loading Spinner */
        .spinner { animation: spin 1s linear infinite; width: 16px; height: 16px; border: 2px solid var(--text-secondary); border-top: 2px solid transparent; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: 5px;}
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
    <!-- Marked for Markdown -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <!-- Diff Parser -->
    <script src="https://cdn.jsdelivr.net/npm/diff@5.1.0/dist/diff.min.js"></script>
</head>
<body>

    <!-- Sidebar -->
    <div class="sidebar">
        <div class="sidebar-header">
            <span>Explorer</span>
            <button class="btn" style="background: transparent; border: 1px solid var(--border);" onclick="createNewFile()">+</button>
        </div>
        <div class="file-list" id="fileList">
            <!-- Files injected here -->
        </div>
    </div>

    <!-- Main Editor -->
    <div class="main">
        <div class="tabs" id="tabContainer">
            <!-- Tabs injected here -->
        </div>
        <div id="editor-container"></div>
    </div>

    <!-- Chat Panel -->
    <div class="chat-panel">
        <div class="chat-header">Code Agent</div>
        <div class="chat-history" id="chatHistory">
            <div class="message assistant">Hello! I'm your AI coding assistant. Edit files on the left, then ask me to explain, review, or modify them.</div>
        </div>
        <div class="chat-input-area">
            <textarea id="chatInput" rows="3" placeholder="Instruction (e.g., 'Add validation to login.ts')..."></textarea>
            <div style="display: flex; justify-content: space-between; margin-top: 10px; align-items: center;">
                <span id="statusText" style="font-size: 12px; color: var(--text-secondary);"></span>
                <button class="btn" id="sendBtn">Send</button>
            </div>
        </div>
    </div>

    <!-- Monaco Loader -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.js"></script>
    <script>
        // --- State ---
        const sessionId = crypto.randomUUID();
        let editor;
        let files = {
            'main.ts': { content: 'console.log("Hello World");', language: 'typescript' },
            'utils.ts': { content: 'export function add(a, b) { return a + b; }', language: 'typescript' }
        };
        let activeFile = 'main.ts';

        // --- Initialization ---
        require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
        require(['vs/editor/editor.main'], function() {
            editor = monaco.editor.create(document.getElementById('editor-container'), {
                value: files[activeFile].content,
                language: files[activeFile].language,
                theme: 'vs-dark',
                automaticLayout: true,
                minimap: { enabled: false },
                fontSize: 14
            });

            editor.onDidChangeModelContent(() => {
                files[activeFile].content = editor.getValue();
            });

            renderFiles();
            renderTabs();
        });

        // --- DOM Elements ---
        const fileListEl = document.getElementById('fileList');
        const tabContainerEl = document.getElementById('tabContainer');
        const chatHistoryEl = document.getElementById('chatHistory');
        const chatInputEl = document.getElementById('chatInput');
        const sendBtn = document.getElementById('sendBtn');
        const statusText = document.getElementById('statusText');

        // --- Render Logic ---
        function renderFiles() {
            fileListEl.innerHTML = '';
            Object.keys(files).forEach(filename => {
                const div = document.createElement('div');
                div.className = \`file-item \${filename === activeFile ? 'active' : ''}\`;
                div.textContent = filename;
                div.onclick = () => switchFile(filename);
                fileListEl.appendChild(div);
            });
        }

        function renderTabs() {
            tabContainerEl.innerHTML = '';
            Object.keys(files).forEach(filename => {
                const div = document.createElement('div');
                div.className = \`tab \${filename === activeFile ? 'active' : ''}\`;
                div.innerHTML = \`\${filename} <span class="tab-close" onclick="closeFile('\${filename}', event)">×</span>\`;
                div.onclick = () => switchFile(filename);
                tabContainerEl.appendChild(div);
            });
        }

        // --- Actions ---
        function switchFile(filename) {
            activeFile = filename;
            if (editor) {
                const model = editor.getModel(); // In a real app we'd swap models, here we just set value for simplicity in v1
                monaco.editor.setModelLanguage(model, getLang(filename));
                editor.setValue(files[filename].content);
            }
            renderFiles();
            renderTabs();
        }

        function createNewFile() {
            const name = prompt("File name:", "new.ts");
            if (name && !files[name]) {
                files[name] = { content: "", language: getLang(name) };
                switchFile(name);
            }
        }

        function closeFile(filename, e) {
            e.stopPropagation();
            if (Object.keys(files).length <= 1) return; // Keep at least one
            delete files[filename];
            if (activeFile === filename) {
                switchFile(Object.keys(files)[0]);
            } else {
                renderFiles();
                renderTabs();
            }
        }

        function getLang(name) {
            if (name.endsWith('.json')) return 'json';
            if (name.endsWith('.html')) return 'html';
            return 'typescript';
        }

        // --- Chat Interaction ---
        sendBtn.onclick = async () => {
            const input = chatInputEl.value.trim();
            if (!input) return;

            // Add User Message
            appendMessage('user', input);
            chatInputEl.value = '';
            sendBtn.disabled = true;
            statusText.innerHTML = '<span class="spinner"></span> Thinking...';

            try {
                // Prepare context
                const fileContext = {};
                for (const [name, file] of Object.entries(files)) {
                    fileContext[name] = file.content;
                }

                const res = await fetch('/agent/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId,
                        input,
                        files: fileContext
                    })
                });
                
                const data = await res.json();

                if (data.error) {
                    appendMessage('assistant', \`**Error:** \${data.error.message}\n\n\`\`\`\n\${data.error.details || ''}\n\`\`\`\`);
                } else if (data.artifact) {
                    // It's a diff
                    appendMessage('assistant', \`I have generated changes based on your request. Applying patches...\n\n\`\`\`diff\n\${data.artifact}\n\`\`\`\`);
                    applyDiff(data.artifact);
                } else {
                    // It's text
                    appendMessage('assistant', data.response);
                }
                
                statusText.innerText = \`Ready (Last intent: \${data.intent})\`;

            } catch (e) {
                appendMessage('assistant', \`**Network Error:** \${e.message}\`);
                statusText.innerText = 'Error';
            } finally {
                sendBtn.disabled = false;
            }
        };

        function appendMessage(role, text) {
            const div = document.createElement('div');
            div.className = \`message \${role}\`;
            div.innerHTML = marked.parse(text);
            chatHistoryEl.appendChild(div);
            chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
        }

        function applyDiff(diffData) {
            // Primitive diff application using npm 'diff' package loaded from CDN
            // We need to parse the unified diff and patch the strings.
            try {
                const patches = Diff.parsePatch(diffData);
                let patchesApplied = 0;

                patches.forEach(patch => {
                    const filename = patch.newFileName.replace(/^b\//, '').replace(/^a\//, ''); // Git diffs usually have a/ b/ prefix
                    if (files[filename]) {
                        const original = files[filename].content;
                        const patched = Diff.applyPatch(original, patch);
                        if (patched) {
                            files[filename].content = patched;
                            patchesApplied++;
                        } else {
                            console.error('Failed to apply patch for', filename);
                        }
                    }
                });

                if (patchesApplied > 0) {
                     // Refresh editor
                    if (files[activeFile]) editor.setValue(files[activeFile].content);
                    statusText.innerText = \`Applied changes to \${patchesApplied} files.\`;
                } else {
                     statusText.innerText = 'Warning: No files were updated by the diff.';
                }

            } catch (e) {
                console.error("Diff apply error", e);
                appendMessage('assistant', \`**System Error:** Failed to apply diff automatically. \${e.message}\`);
            }
        }

    </script>
</body>
</html>
`;
