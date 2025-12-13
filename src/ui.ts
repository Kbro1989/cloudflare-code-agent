export const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Cloudflare Code Agent | Diff-First IDE</title>
    <style>
        :root {
            --bg-root: #0d1117;
            --bg-sidebar: #010409;
            --bg-editor: #0d1117;
            --bg-panel: #161b22;
            --border: #30363d;
            --accent: #238636;
            --danger: #da3633;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
        }
        * { box-sizing: border-box; }
        body { margin: 0; display: flex; height: 100vh; background: var(--bg-root); color: var(--text-primary); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; overflow: hidden; }
        
        /* Layout */
        .sidebar { width: 250px; background: var(--bg-sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
        .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .props-panel { width: 350px; background: var(--bg-panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; }

        /* Sidebar Elements */
        .sidebar-header { padding: 10px; font-weight: bold; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .file-list { flex: 1; overflow-y: auto; padding: 5px; }
        .file-item { padding: 8px 10px; cursor: pointer; display: flex; align-items: center; gap: 5px; border-radius: 4px; color: var(--text-secondary); }
        .file-item:hover { background: #21262d; color: var(--text-primary); }
        .file-item.active { background: #21262d; color: #fff; border-left: 3px solid #f78166; }
        .file-item.modified { color: #e3b341; }
        
        /* Main Area Elements */
        .tabs { display: flex; background: var(--bg-sidebar); border-bottom: 1px solid var(--border); overflow-x: auto; height: 35px; }
        .tab { padding: 0 15px; cursor: pointer; border-right: 1px solid var(--border); background: var(--bg-sidebar); display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
        .tab.active { background: var(--bg-editor); border-top: 2px solid #f78166; color: var(--text-primary); }
        .action-bar { padding: 8px 15px; background: var(--bg-panel); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; }
        
        #editor-container { flex: 1; position: relative; }
        
        /* Controls */
        .btn { background: #21262d; color: var(--text-primary); border: 1px solid var(--border); padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 5px; }
        .btn-primary { background: var(--accent); color: white; border-color: rgba(255,255,255,0.1); }
        .btn-danger { background: var(--danger); color: white; border-color: rgba(255,255,255,0.1); }
        .btn:hover { opacity: 0.9; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        select { background: #21262d; color: var(--text-primary); border: 1px solid var(--border); padding: 4px 8px; border-radius: 6px; outline: none; }
        
        /* Props Panel / Validation Pipeline */
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

    </style>
</head>
<body>

    <!-- Sidebar -->
    <div class="sidebar">
        <div class="sidebar-header">
            <span>Explorer</span>
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
                    <option value="@cf/meta/llama-3.1-8b-instruct">Llama 3.1 8B (Fast)</option>
                    <option value="@cf/meta/llama-3.1-70b-instruct">Llama 3.1 70B (Smart)</option>
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

    <script src="https://cdntest.cloudflare.com/monaco-editor/0.45.0/min/vs/loader.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/diff@5.1.0/dist/diff.min.js"></script>
    <script>
        // --- State ---
        let sessionId = localStorage.getItem('agentSessionId');
        if (!sessionId) { sessionId = crypto.randomUUID(); localStorage.setItem('agentSessionId', sessionId); }
        
        let editor; // Monaco Editor or DiffEditor
        let modelObj; // Current Monaco Model
        let diffNavigator;
        
        // Mode: 'edit' or 'diff'
        let mode = 'edit';
        let proposedContent = null;
        
        let files = {
            'main.ts': { content: 'console.log("Hello World");', language: 'typescript' }
        };
        let activeFile = 'main.ts';

        // --- Init ---
        require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
        require(['vs/editor/editor.main'], async () => {
            const saved = await loadWorkspace();
            if (saved) {
                files = saved;
                activeFile = Object.keys(files)[0] || 'main.ts';
            }
            
            initEditor();
            renderUI();
        });

        function initEditor() {
            if (editor) editor.dispose();
            const container = document.getElementById('editor-container');
            container.innerHTML = '';
            
            if (mode === 'edit') {
                editor = monaco.editor.create(container, {
                    value: files[activeFile]?.content || "",
                    language: files[activeFile]?.language || "typescript",
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
                // Diff Mode
                editor = monaco.editor.createDiffEditor(container, {
                    theme: 'vs-dark',
                    automaticLayout: true,
                    originalEditable: false,
                    readOnly: true
                });
                
                const originalModel = monaco.editor.createModel(files[activeFile].content, files[activeFile].language);
                const modifiedModel = monaco.editor.createModel(proposedContent, files[activeFile].language);
                
                editor.setModel({
                    original: originalModel,
                    modified: modifiedModel
                });
            }
        }

        // --- UI Rendering ---
        function renderUI() {
            renderFiles();
            renderTabs();
            
            document.getElementById('currentFileLabel').textContent = activeFile;
            
            const diffActions = document.getElementById('diffActions');
            if (mode === 'diff') diffActions.classList.add('active');
            else diffActions.classList.remove('active');
        }

        function renderFiles() {
            const el = document.getElementById('fileList');
            el.innerHTML = '';
            Object.keys(files).forEach(f => {
                const div = document.createElement('div');
                div.className = \`file-item \${f === activeFile ? 'active' : ''}\`;
                div.textContent = f;
                div.onclick = () => switchFile(f);
                el.appendChild(div);
            });
        }
        
        function renderTabs() {
            const el = document.getElementById('tabContainer');
            el.innerHTML = '';
            Object.keys(files).forEach(f => {
                 const div = document.createElement('div');
                 div.className = \`tab \${f === activeFile ? 'active' : ''}\`;
                 div.textContent = f;
                 div.onclick = () => switchFile(f);
                 el.appendChild(div);
            });
        }

        function switchFile(name) {
            if (mode === 'diff') {
                alert("Please Accept or Reject the current diff first.");
                return;
            }
            activeFile = name;
            
            // Update editor model
            const newContent = files[name].content;
            const newLang = files[name].language;
            
            const currentModel = editor.getModel();
            if (currentModel) {
                 monaco.editor.setModelLanguage(currentModel, newLang);
                 currentModel.setValue(newContent);
            }
            
            renderUI();
        }

        function createNewFile() {
             const name = prompt("Filename:", "new.ts");
             if(name) {
                 files[name] = { content: "", language: "typescript" };
                 switchFile(name);
             }
        }

        // --- Agent Execution ---
        document.getElementById('runBtn').onclick = async () => {
            const input = document.getElementById('promptInput').value;
            if(!input) return;
            
            document.getElementById('runBtn').disabled = true;
            document.getElementById('runBtn').textContent = "Running...";
            
            resetPipeline();
            
            const model = document.getElementById('modelSelect').value;
            
            try {
                // Simplify: Send all files for context
                const fileContext = {};
                for(const k in files) fileContext[k] = files[k].content;

                const res = await fetch('/agent/run', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ sessionId, input, files: fileContext, model })
                });
                
                const data = await res.json();
                
                if (data.steps) updatePipeline(data.steps);
                if (data.metrics) updateTelemetry(data.metrics);
                
                if (data.artifact && data.intent !== 'explain') {
                    // It's a diff. Let's parse it and engage Diff Mode.
                     try {
                        const patches = Diff.parsePatch(data.artifact);
                        // Find patch for active file
                        // Simplified: Assume patch is for active file or first file in patch
                        const patch = patches.find(p => p.oldFileName.includes(activeFile) || p.newFileName.includes(activeFile)) || patches[0];
                        
                        if (patch) {
                            const original = files[activeFile].content;
                            proposedContent = Diff.applyPatch(original, patch);
                            
                            if (proposedContent === false) throw new Error("Patch failed to apply cleanly");
                            
                            // Enter Diff Mode
                            mode = 'diff';
                            initEditor();
                            renderUI();
                        } else {
                            alert("Agent generated a diff, but not for the active file. (Multi-file diff UI not implemented in V1)");
                            console.log(data.artifact);
                        }
                     } catch(e) {
                         alert("Error applying patch: " + e.message);
                     }
                } else if (data.response) {
                    alert("Agent Message:\n" + data.response);
                }
                
            } catch (e) {
                alert("Error: " + e.message);
            } finally {
                document.getElementById('runBtn').disabled = false;
                document.getElementById('runBtn').textContent = "Run Agent";
            }
        };
        
        // --- Pipeline & Telemetry ---
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
                const id = map[step.name];
                if(id) {
                    const el = document.getElementById(id);
                    el.className = \`pipeline-step \${step.status}\`;
                    const icon = el.querySelector('.step-icon');
                    if (step.status === 'success') icon.textContent = '✓';
                    if (step.status === 'failure') icon.textContent = '✗';
                    if (step.status === 'running') icon.textContent = '◎';
                }
            });
        }
        
        function updateTelemetry(metrics) {
            const el = document.getElementById('telemetry');
            el.innerHTML = \`
                <div class="badge">Latency: \${Math.round(metrics.durationMs)}ms</div>
                <div class="badge">Est. Cost: $0.0002</div>
            \`;
        }

        // --- Diff Actions ---
        window.acceptDiff = function() {
            files[activeFile].content = proposedContent;
            mode = 'edit';
            initEditor();
            renderUI();
            debouncedSave();
        };

        window.rejectDiff = function() {
            mode = 'edit';
            initEditor();
            renderUI();
        };
        
        // --- Persistence (copy from phase 3) ---
        async function loadWorkspace() {
             try {
                const res = await fetch(\`/api/workspace?sessionId=\${sessionId}\`);
                const data = await res.json();
                return data.files;
             } catch (e) { return null; }
        }
        
        let saveTimeout;
        function debouncedSave() {
             clearTimeout(saveTimeout);
             saveTimeout = setTimeout(async () => {
                 await fetch('/api/workspace', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, files })
                });
             }, 1000);
        }

    </script>
</body>
</html>
