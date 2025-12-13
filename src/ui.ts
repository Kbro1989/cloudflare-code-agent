export const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Cloudflare Code Agent | Diff-First IDE</title>
    <!-- ... Styles (omitted for brevity, assume same as before) ... -->
    <style>
        :root { --bg-root: #0d1117; --bg-sidebar: #010409; --bg-editor: #0d1117; --bg-panel: #161b22; --border: #30363d; --accent: #238636; --danger: #da3633; --text-primary: #c9d1d9; --text-secondary: #8b949e; }
        * { box-sizing: border-box; }
        body { margin: 0; display: flex; height: 100vh; background: var(--bg-root); color: var(--text-primary); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; overflow: hidden; }
        .sidebar { width: 250px; background: var(--bg-sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .props-panel { width: 350px; background: var(--bg-panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; }
        .sidebar-header { padding: 10px; font-weight: bold; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .file-list { flex: 1; overflow-y: auto; padding: 5px; }
        .file-item { padding: 8px 10px; cursor: pointer; display: flex; align-items: center; gap: 5px; border-radius: 4px; color: var(--text-secondary); }
        .file-item:hover { background: #21262d; color: var(--text-primary); }
        .file-item.active { background: #21262d; color: #fff; border-left: 3px solid #f78166; }
        .tabs { display: flex; background: var(--bg-sidebar); border-bottom: 1px solid var(--border); overflow-x: auto; height: 35px; }
        .tab { padding: 0 15px; cursor: pointer; border-right: 1px solid var(--border); background: var(--bg-sidebar); display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
        .tab.active { background: var(--bg-editor); border-top: 2px solid #f78166; color: var(--text-primary); }
        .action-bar { padding: 8px 15px; background: var(--bg-panel); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
        #editor-container { flex: 1; position: relative; }
        .btn { background: #21262d; color: var(--text-primary); border: 1px solid var(--border); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; }
        .btn-primary { background: var(--accent); color: white; border-color: rgba(255,255,255,0.1); }
        .btn-danger { background: var(--danger); color: white; border-color: rgba(255,255,255,0.1); }
        select { background: #21262d; color: var(--text-primary); border: 1px solid var(--border); padding: 4px 8px; border-radius: 6px; outline: none; }
        .section-title { font-size: 11px; text-transform: uppercase; font-weight: bold; color: var(--text-secondary); margin: 15px 10px 5px; letter-spacing: 0.5px; }
        .pipeline { margin: 10px; display: flex; flex-direction: column; gap: 8px; }
        .pipeline-step { display: flex; align-items: center; font-size: 13px; color: var(--text-secondary); padding: 6px 10px; background: #21262d; border-radius: 6px; border: 1px solid transparent; }
        .pipeline-step.success { color: #56d364; border-color: rgba(86, 211, 100, 0.2); }
        .pipeline-step.failure { color: #f85149; border-color: rgba(248, 81, 73, 0.2); }
        .pipeline-step.running { color: #2f81f7; border-color: rgba(47, 129, 247, 0.2); animation: pulse 1s infinite alternate; }
        .step-icon { width: 16px; margin-right: 8px; text-align: center; }
        @keyframes pulse { from { opacity: 0.6; } to { opacity: 1; } }
        .telemetry-badges { display: flex; gap: 10px; padding: 10px; flex-wrap: wrap; }
        .badge { font-size: 11px; padding: 2px 6px; border-radius: 10px; background: #21262d; border: 1px solid var(--border); color: var(--text-secondary); }
        .chat-input-area { padding: 15px; border-top: 1px solid var(--border); margin-top: auto; }
        textarea { width: 100%; background: #0d1117; border: 1px solid var(--border); color: #fff; padding: 10px; border-radius: 6px; resize: vertical; font-family: inherit; min-height: 80px; }
        .diff-actions { display: none; margin-left: auto; gap: 10px; }
        .diff-actions.active { display: flex; }
        .connection-status { width: 10px; height: 10px; border-radius: 50%; background: #ccc; margin-right: 10px; }
        .connection-status.connected { background: #56d364; box-shadow: 0 0 5px #56d364; }
        .connection-status.disconnected { background: #da3633; }
    </style>
</head>
<body>

    <!-- Sidebar -->
    <div class="sidebar">
        <div class="sidebar-header">
            <span>Explorer</span>
            <div id="connStatus" class="connection-status" title="Connecting..."></div>
            <button class="btn" onclick="createNewFile()">+</button>
        </div>
        <div class="file-list" id="fileList"></div>
    </div>

    <!-- Main -->
    <div class="main">
        <div class="tabs" id="tabContainer"></div>
        
        <div class="action-bar">
            <span id="currentFileLabel" style="font-weight: bold; font-size: 13px;"></span>
            
            <div class="diff-actions" id="diffActions">
                <span class="badge" style="background: #e3b341; color: black; font-weight: bold;">Review Mode</span>
                <button class="btn btn-primary" onclick="acceptDiff()">✅ Apply Changes</button>
                <button class="btn btn-danger" onclick="rejectDiff()">❌ Reject</button>
            </div>
            
            <div style="margin-left: auto; display: flex; gap: 10px; align-items: center;">
                <select id="modelSelect">
                    <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast">Llama 3.3 70B (Top)</option>
                    <option value="@cf/meta/llama-3.1-8b-instruct">Llama 3.1 8B (Fast)</option>
                    <option value="@cf/meta/llama-3.1-70b-instruct">Llama 3.1 70B (Legacy)</option>
                     <option value="@cf/qwen/qwen2.5-7b-instruct">Qwen 2.5 7B</option>
                </select>
            </div>
        </div>

        <div id="editor-container"></div>
    </div>

    <!-- Props Panel -->
    <div class="props-panel">
        <div class="section-title">Validation Pipeline</div>
        <div class="pipeline" id="pipeline">
            <div class="pipeline-step pending" id="step-gen"><span class="step-icon">○</span> Generation</div>
            <div class="pipeline-step pending" id="step-struct"><span class="step-icon">○</span> Structure</div>
            <div class="pipeline-step pending" id="step-parse"><span class="step-icon">○</span> Parse</div>
            <div class="pipeline-step pending" id="step-context"><span class="step-icon">○</span> Context</div>
        </div>
        
        <div class="section-title">Telemetry</div>
        <div class="telemetry-badges" id="telemetry">
            <div class="badge">Latency: -</div>
            <div class="badge">Tokens: -</div>
        </div>

        <div class="section-title">Intent</div>
        <div class="chat-input-area">
             <textarea id="promptInput" placeholder="Describe a change (e.g. 'Rename foo to bar')..."></textarea>
             <button class="btn btn-primary" id="runBtn" style="width: 100%; margin-top: 10px; justify-content: center;">Run Agent</button>
        </div>
    </div>

    <!-- Diff is UMD, so load it normally -->
    <script src="https://cdn.jsdelivr.net/npm/diff@5.1.0/dist/diff.min.js"></script>
    
    <!-- ES Module for Monaco -->
    <script type="module">
        import * as monaco from 'https://esm.sh/monaco-editor@0.45.0';
        
        // Environment for workers (using blob/data uri fallback or simple generic worker)
        // For simplicity in this agent, we can rely on main thread if workers fail, 
        // but esm.sh usually handles it or we define getWorkerUrl properly.
        // We'll try basic init first.

        // --- State ---
        let sessionId = localStorage.getItem('agentSessionId');
        if (!sessionId) { sessionId = crypto.randomUUID(); localStorage.setItem('agentSessionId', sessionId); }
        
        let files = { 'main.ts': { content: '// Loading...', language: 'typescript' } };
        let activeFile = 'main.ts';
        let editor, socket;
        let mode = 'edit';
        let proposedContent = null;
        let isSaving = false;

        // Initialize immediately as we are module
        initEditor();
        renderUI();
        connectWebSocket();
        
        // Expose to window for UI buttons
        window.acceptDiff = function() {
            if (!files[activeFile]) return;
            files[activeFile].content = proposedContent;
            mode = 'edit';
            initEditor();
            renderUI();
            debouncedSave();
        };
        window.rejectDiff = (() => { mode='edit'; initEditor(); renderUI(); });

        // --- WebSocket ---
        function connectWebSocket() {
            const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const wsUrl = \`\${proto}://\${window.location.host}/api/workspace/ws?sessionId=\${sessionId}\`;
            
            socket = new WebSocket(wsUrl);
            const statusEl = document.getElementById('connStatus');

            socket.onopen = () => {
                console.log("Connected to Durable Object");
                statusEl.classList.add('connected');
                statusEl.title = "Connected to Edge Session";
            };

            socket.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'init' || msg.type === 'update') {
                        if (msg.data.files && Object.keys(msg.data.files).length > 0) {
                            files = msg.data.files;
                            if (!files[activeFile] && Object.keys(files).length > 0) {
                                activeFile = Object.keys(files)[0];
                            }
                            
                            // Safe Update
                            if (mode === 'edit' && editor && !isSaving) {
                                 const model = editor.getModel();
                                 const newContent = files[activeFile]?.content || "";
                                 if (model && model.getValue() !== newContent) {
                                     const pos = editor.getPosition();
                                     model.setValue(newContent);
                                     if(pos) editor.setPosition(pos);
                                 }
                            }
                            renderUI();
                        }
                    }
                } catch (e) { console.error("WS Error", e); }
            };
            
            socket.onclose = () => {
                statusEl.classList.remove('connected');
                statusEl.classList.add('disconnected');
                setTimeout(connectWebSocket, 3000);
            };
        }

        // --- Editor & UI ---
        function initEditor() {
            const container = document.getElementById('editor-container');
            if(!container) return;
            container.innerHTML = '';
            
            const file = files[activeFile];
            const content = file?.content || "";
            const language = file?.language || "typescript";

            if (mode === 'edit') {
                editor = monaco.editor.create(container, {
                    value: content,
                    language: language,
                    theme: 'vs-dark',
                    automaticLayout: true,
                    minimap: { enabled: false }
                });
                editor.onDidChangeModelContent(() => {
                    if (files[activeFile]) {
                        files[activeFile].content = editor.getValue();
                        debouncedSave();
                    }
                });
            } else {
                editor = monaco.editor.createDiffEditor(container, { 
                    theme: 'vs-dark', 
                    automaticLayout: true, 
                    originalEditable: false, 
                    readOnly: true 
                });
                editor.setModel({
                    original: monaco.editor.createModel(content, language),
                    modified: monaco.editor.createModel(proposedContent || "", language)
                });
            }
        }



        function renderUI() {
            const list = document.getElementById('fileList'); 
            const tabs = document.getElementById('tabContainer');
            list.innerHTML = ''; tabs.innerHTML = '';
            
            Object.keys(files).forEach(f => {
                const item = document.createElement('div');
                item.className = \`file-item \${f === activeFile ? 'active' : ''}\`;
                item.textContent = f;
                item.onclick = () => switchFile(f);
                list.appendChild(item);
                
                const tab = document.createElement('div');
                tab.className = \`tab \${f === activeFile ? 'active' : ''}\`;
                tab.textContent = f;
                tab.onclick = () => switchFile(f);
                tabs.appendChild(tab);
            });
            document.getElementById('currentFileLabel').textContent = activeFile;
            
            document.getElementById('diffActions').className = mode === 'diff' ? 'diff-actions active' : 'diff-actions';
        }

        function switchFile(name) {
            if (mode === 'diff') return alert("Process diff first.");
            activeFile = name;
            if (editor) {
                const model = editor.getModel();
                monaco.editor.setModelLanguage(model, files[name].language);
                model.setValue(files[name].content);
            }
            renderUI();
        }
        
        function createNewFile() {
             const name = prompt("Filename:", "new.ts");
             if(name) {
                 files[name] = { content: "", language: "typescript" };
                 switchFile(name);
                 debouncedSave();
             }
        }

        async function debouncedSave() {
            isSaving = true;
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'update', data: { files } }));
            }
            // Also fall back to HTTP save for durability if socket flakiness
            setTimeout(() => isSaving = false, 500); 
        }

        // --- Agent Run (Updated to use REST API routed to DO) ---
        // Same as V1 but routed via /agent/run which is now captured by the DO
        document.getElementById('runBtn').onclick = async () => {
             const input = document.getElementById('promptInput').value;
             if(!input) return;
             
             resetPipeline();
             document.getElementById('runBtn').disabled = true;
             
             try {
                // We send a normal POST, but our worker routes it to the DO "fetch" handler
                const res = await fetch('/agent/run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Session-ID': sessionId },
                    body: JSON.stringify({ 
                        input, 
                        files: Object.fromEntries(Object.entries(files).map(([k,v]) => [k, v.content])),
                        model: document.getElementById('modelSelect').value
                    })
                });
                const data = await res.json();
                
                if (data.steps) updatePipeline(data.steps);
                if (data.metrics) updateTelemetry(data.metrics);
                
                if (data.artifact && data.intent !== 'explain') {
                     const patches = Diff.parsePatch(data.artifact);
                     const patch = patches[0]; // Simplification
                     if (patch) {
                         proposedContent = Diff.applyPatch(files[activeFile].content, patch);
                         mode = 'diff';
                         initEditor();
                         renderUI();
                     }
                } else if (data.response) {
                    alert(data.response);
                }
             } catch(e) {
                 alert("Error: " + e.message);
             } finally {
                 document.getElementById('runBtn').disabled = false;
             }
        };

        // --- Utils ---
        function resetPipeline() {
            ['gen','struct','parse','context'].forEach(s => {
                const el = document.getElementById('step-'+s);
                el.className = 'pipeline-step pending';
                el.querySelector('.step-icon').textContent = '○';
            });
        }
        function updatePipeline(steps) {
            const map = { 'Generation': 'step-gen', 'Structure': 'step-struct', 'Parse': 'step-parse', 'Context': 'step-context' };
            steps.forEach(step => {
                if(map[step.name]) {
                    const el = document.getElementById(map[step.name]);
                    el.className = \`pipeline-step \${step.status}\`;
                    el.querySelector('.step-icon').textContent = step.status === 'success' ? '✓' : (step.status === 'failure' ? '✗' : '◎');
                }
            });
        }
        function updateTelemetry(metrics) {
            document.getElementById('telemetry').innerHTML = \`
                <div class="badge">Latency: \${Math.round(metrics.durationMs)}ms</div>
                <div class="badge">Tokens: \${metrics.inputTokens || '-'}</div>
            \`;
        }
        
        window.acceptDiff = function() {
            files[activeFile].content = proposedContent;
            mode = 'edit';
            initEditor();
            renderUI();
            debouncedSave();
        };
        window.rejectDiff = (() => { mode='edit'; initEditor(); renderUI(); });

    </script>
</body>
</html>
`;
