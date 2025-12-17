
export const IDE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hybrid IDE (Cloudflare Code Agent)</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.min.js"></script>
    <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        body { background-color: #0f172a; color: #e2e8f0; font-family: 'Inter', sans-serif; overflow: hidden; }
        .glass-panel { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1); }
        .scroll-smooth::-webkit-scrollbar { width: 6px; }
        .scroll-smooth::-webkit-scrollbar-thumb { background-color: #475569; border-radius: 3px; }
        .chat-message { animation: fadeIn 0.3s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .typing-indicator span { display: inline-block; width: 6px; height: 6px; background-color: #94a3b8; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out; margin: 0 1px; }
        .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
        .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        model-viewer { width: 100%; height: 100%; background-color: #0f172a; --poster-color: transparent; }
    </style>
</head>
<body class="h-screen flex flex-col">

    <!-- Top Navigation -->
    <nav class="h-14 glass-panel flex items-center justify-between px-4 z-20 shadow-lg">
        <div class="flex items-center space-x-3">
            <i class="fa-solid fa-cloud-bolt text-indigo-400 text-xl"></i>
            <span class="font-bold text-lg tracking-tight">Hybrid<span class="text-indigo-400">IDE</span></span>
            <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">v4.2 3D-Engine</span>
        </div>
        <div class="flex items-center space-x-4">
            <select id="modelSelector" class="bg-slate-800 text-xs text-slate-300 border border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500 transition-colors">
                <option value="default">⚡ Llama 3.3 (Fast)</option>
                <option value="thinking">🧠 DeepSeek R1 (Reasoning)</option>
            </select>
            <select id="styleSelector" class="bg-slate-800 text-xs text-slate-300 border border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500 transition-colors">
                <option value="speed">⚡ Flux (Speed)</option>
                <option value="realism">📸 Realism (SDXL)</option>
                <option value="artistic">🎨 Artistic (Dreamshaper)</option>
            </select>
            <div id="statusIndicator" class="flex items-center space-x-2 text-xs text-slate-400">
                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Online</span>
            </div>
            <button onclick="deployProject()" class="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded text-sm transition-colors flex items-center space-x-2 shadow-lg shadow-indigo-500/20">
                <i class="fa-solid fa-rocket"></i> <span>Deploy</span>
            </button>
        </div>
    </nav>

    <!-- Main Workspace -->
    <div class="flex-1 flex overflow-hidden">

        <!-- Sidebar (File Explorer) -->
        <aside class="w-64 glass-panel border-r border-slate-700 flex flex-col transition-all duration-300" id="sidebar">
            <div class="p-3 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/50">
                <span class="text-sm font-semibold text-slate-300">EXPLORER</span>
                <div class="space-x-1">
                    <button class="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition" onclick="refreshFiles()"><i class="fa-solid fa-rotate-right"></i></button>
                    <button class="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition" onclick="createNewFile()"><i class="fa-solid fa-plus"></i></button>
                </div>
            </div>
            <div id="fileList" class="flex-1 overflow-y-auto p-2 space-y-0.5 text-sm">
                <div class="animate-pulse flex space-x-2 p-2"><div class="rounded-full bg-slate-700 h-4 w-4"></div><div class="h-4 bg-slate-700 rounded w-3/4"></div></div>
            </div>
        </aside>

        <!-- Editor Area -->
        <main class="flex-1 relative bg-[#1e1e1e] flex flex-col min-w-0">
            <!-- Tabs -->
            <div class="h-9 bg-[#2d2d2d] flex items-center border-b border-[#3e3e3e] overflow-x-auto select-none" id="tabsContainer">
                <div class="px-3 py-2 bg-[#1e1e1e] border-t-2 border-indigo-500 text-slate-200 text-xs flex items-center space-x-2 min-w-fit">
                    <span id="activeFileName">src/index.ts</span>
                    <button class="hover:text-red-400" onclick="closeTab()"><i class="fa-solid fa-times"></i></button>
                </div>
            </div>

            <div id="editorContainer" class="flex-1 relative">
                <!-- Monaco or ModelViewer mounts here -->
            </div>

            <div class="h-8 bg-slate-800 border-t border-slate-700 flex items-center px-4 justify-between text-xs text-slate-400">
                <div class="flex space-x-4">
                    <span class="hover:text-slate-200 cursor-pointer"><i class="fa-solid fa-terminal mr-1"></i> TERMINAL</span>
                    <span class="hover:text-slate-200 cursor-pointer"><i class="fa-solid fa-triangle-exclamation mr-1"></i> PROBLEMS</span>
                </div>
                <div>Ln <span id="cursorLine">1</span>, Col <span id="cursorCol">1</span></div>
            </div>
        </main>

        <!-- Chat Panel -->
        <aside class="w-80 glass-panel border-l border-slate-700 flex flex-col shadow-xl z-10" id="chatPanel">
            <div class="p-3 border-b border-slate-700/50 bg-slate-800/50 flex justify-between items-center backdrop-blur-md">
                <span class="text-sm font-semibold flex items-center gap-2"><i class="fa-solid fa-robot text-indigo-400"></i> AI Assistant</span>
                <span id="providerBadge" class="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">Llama 3.3</span>
            </div>

            <div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
                <div class="chat-message bg-slate-800/50 p-3 rounded-lg border border-slate-700/50">
                    <p class="text-sm text-slate-300">Hello! I'm your Super-Agent. 🧞‍♂️</p>
                    <ul class="text-xs text-slate-400 mt-2 list-disc list-inside space-y-1">
                        <li><b>Review/Code:</b> Llama 3.3 (Fast)</li>
                        <li><b>Reasoning:</b> DeepSeek R1 (Smart)</li>
                        <li><b>Generate:</b> <code>/image cyberpunk city</code></li>
                        <li><b>3D:</b> Upload .glb to view!</li>
                    </ul>
                </div>
            </div>

            <!-- Chat Input -->
            <!-- Chat Input -->
            <div class="p-3 bg-slate-800/80 border-t border-slate-700/50 backdrop-blur">
                <input type="file" id="visionInput" class="hidden" onchange="uploadFile(this)">
                <div class="relative flex items-center gap-2">
                    <button onclick="document.getElementById('visionInput').click()" class="text-slate-400 hover:text-indigo-400 transition-colors p-2 rounded-lg hover:bg-slate-700/50" title="Upload Image/File">
                        <i class="fa-solid fa-paperclip"></i>
                    </button>
                    <div class="relative flex-1">
                        <textarea id="chatInput" rows="1" class="w-full bg-slate-900 border border-slate-600 rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-none scroll-smooth transition-all" placeholder="Ask AI or type /image..."></textarea>
                        <button onclick="sendMessage()" class="absolute right-2 top-1.5 text-indigo-400 hover:text-indigo-300 p-1 transition-colors"><i class="fa-solid fa-paper-plane"></i></button>
                    </div>
                </div>
                <div class="text-[10px] text-slate-500 mt-1.5 flex justify-between px-1">
                    <span>Ctrl+Enter to send</span>
                    <span id="tokenCount">0 tokens</span>
                </div>
            </div>
        </aside>

    </div>

    <!-- Scripts -->
    <script>
        // --- Deployment Logic ---
        window.deployProject = async function() {
            const scriptName = prompt("Enter a unique name for your Cloudflare Worker app:", "my-awesome-agent");
            if (!scriptName) return;

            const btn = document.querySelector('button[onclick="deployProject()"]');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deploying...';
            btn.disabled = true;

            try {
                // For MVP, we deploy the content of src/index.ts or current editor content
                let codeToDeploy = currentCode;

                // If current file isn't meaningful, try to fetch src/index.ts
                if (!activeFile.endsWith('.ts') && !activeFile.endsWith('.js')) {
                     try {
                        const res = await fetch('/api/fs/file?name=' + encodeURIComponent('src/index.ts'));
                        const d = await res.json();
                        codeToDeploy = d.content;
                     } catch(e) {}
                }

                if (!codeToDeploy) {
                    alert("No code found to deploy! Open a file first.");
                    return;
                }

                const res = await fetch('/api/deploy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scriptName, code: codeToDeploy })
                });

                const result = await res.json();

                if (res.ok) {
                    alert('🚀 Success! Deployed to namespace \\'' + result.result.namespace + '\\'.\\nScript: ' + result.result.script);
                } else {
                     alert('Deployment Failed: ' + (result.error || 'Unknown Error (Check Server Logs)'));
                }

            } catch (e) {
                alert('Deployment Error: ' + e.message);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }

        // --- Monaco Editor Setup ---
        require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});

        let editor;
        let activeFile = 'loading...';
        let currentCode = '';
        let fileTree = [];

        require(['vs/editor/editor.main'], function() {
            monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                target: monaco.languages.typescript.ScriptTarget.ES2020,
                allowNonTsExtensions: true,
                moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
            });

            editor = monaco.editor.create(document.getElementById('editorContainer'), {
                value: '// Select a file to view content',
                language: 'typescript',
                theme: 'vs-dark',
                automaticLayout: true,
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: 'Consolas, "Courier New", monospace',
                padding: { top: 16 },
                scrollBeyondLastLine: false,
                smoothScrolling: true
            });

            editor.onDidChangeCursorPosition((e) => {
                document.getElementById('cursorLine').innerText = e.position.lineNumber;
                document.getElementById('cursorCol').innerText = e.position.column;
            });

            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                saveCurrentFile(activeFile, editor.getValue());
            });

            refreshFiles();
        });

        const modelSelector = document.getElementById('modelSelector');
        const providerBadge = document.getElementById('providerBadge');

        modelSelector.addEventListener('change', (e) => {
            const isDeepSeek = e.target.value === 'thinking';
            providerBadge.innerText = isDeepSeek ? 'DeepSeek R1' : 'Llama 3.3';
            providerBadge.className = isDeepSeek
                ? 'text-[10px] bg-indigo-900/50 text-indigo-300 ring-1 ring-indigo-500 px-1.5 py-0.5 rounded'
                : 'text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300';
        });

        // --- File System Operations ---
        async function refreshFiles() {
            const listEl = document.getElementById('fileList');
            listEl.innerHTML = '<div class="text-slate-500 text-xs p-2">Loading...</div>';
            try {
                const res = await fetch('/api/fs/list');
                const uniqueFiles = new Map();
                (await res.json()).forEach(f => uniqueFiles.set(f.name, f));
                const files = Array.from(uniqueFiles.values());

                fileTree = files;
                renderFileList(files);

                if (activeFile === 'loading...' && files.find(f => f.name === 'src/index.ts')) {
                    loadFile('src/index.ts');
                }
            } catch (e) { listEl.innerHTML = '<div class="text-red-400 text-xs p-2">Failed</div>'; }
        }

        function renderFileList(files) {
            const listEl = document.getElementById('fileList');
            listEl.innerHTML = '';
            files.sort((a, b) => a.name.localeCompare(b.name));

            files.forEach(file => {
                const div = document.createElement('div');
                const isImg = file.name.match(/\\.(png|jpg|jpeg|gif)$/i);
                const is3D = file.name.match(/\\.(glb|gltf)$/i);

                let iconClass = 'fa-regular fa-file-code';
                if (isImg) iconClass = 'fa-regular fa-file-image';
                if (is3D) iconClass = 'fa-solid fa-cube text-indigo-400';

                div.className = 'group flex items-center justify-between px-3 py-1.5 text-slate-300 hover:bg-slate-700/50 cursor-pointer rounded-md transition-colors';
                div.innerHTML = \`
                    <div class="flex items-center gap-2 truncate" onclick="loadFile('\${file.name}')">
                        <i class="\${iconClass} text-slate-500 group-hover:text-indigo-400 transition-colors text-xs"></i>
                        <span>\${file.name}</span>
                    </div>
                \`;
                listEl.appendChild(div);
            });
        }

        let activeFile = null;
        let activeImage = null; // Track image context for Vision

        async function loadFile(name) {
            activeFile = name;
            document.getElementById('activeFileName').innerText = name;
            const container = document.getElementById('editorContainer');

            // 3D Preview
            if (name.match(/\.(glb|gltf)$/i)) {
                 activeImage = null; // Clear vision context for 3D models (unless we want to screenshot them?)
                 const res = await fetch(`/ api / fs / file ? name = ${ encodeURIComponent(name)}`);
                 const blob = await res.blob();
                 const url = URL.createObjectURL(blob);

                 container.innerHTML = `
    < div class="h-full w-full bg-slate-900 relative" >
        <model-viewer
src = "${url}"
id = "mv-viewer"
camera - controls
auto - rotate
shadow - intensity="1"
style = "width: 100%; height: 100%;"
alt = "A 3D model"
background - color="#1e293b"
    > </model-viewer>
    < div class="absolute bottom-5 left-0 right-0 text-center pointer-events-none" >
        <span class="bg-black/50 text-white px-2 py-1 rounded text-xs" > 3D Preview: ${ name } </span>
            </div>
            </div>
                `;
                 return;
            }

            // Image Preview
            if (name.match(/\.(png|jpg)$/i)) {
                 activeImage = name; // Set context for Vision
                 const res = await fetch(\`/api/fs/file?name=\${encodeURIComponent(name)}\`);
                 const data = await res.json();
                 let src = data.content;
                 if (!src.startsWith('data:') && !src.startsWith('http')) {
                     src = \`data:image/png;base64,\${data.content}\`;
                 }

                 container.innerHTML = \`
                    <div class="h-full flex items-center justify-center bg-slate-900">
                        <img src="\${src}" class="max-w-[90%] max-h-[90%] shadow-lg border border-slate-700 rounded">
                    </div>
                 \`;
                 return;
            }

// Code/Text
if (!container.querySelector('.monaco-editor')) {
    location.reload();
    return;
}

try {
    const res = await fetch(\`/api/fs/file?name=\${encodeURIComponent(name)}\`);
                const data = await res.json();
                currentCode = data.content;
                if (editor) {
                    const model = editor.getModel();
                    monaco.editor.setModelLanguage(model, getLanguage(name));
                    editor.setValue(data.content);
                }
            } catch (e) { }
        }

        async function saveCurrentFile(name, content) {
            await fetch('/api/fs/file', {
                method: 'POST',
                body: JSON.stringify({ name, content })
            });
            refreshFiles();
        }

        // --- Chat ---
        const chatInput = document.getElementById('chatInput');
        const chatMessages = document.getElementById('chatMessages');

        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });

        async function sendMessage() {
            const text = chatInput.value.trim();
            if(!text) return;
            chatInput.value = '';

            addMessage('user', text);

            if (text.startsWith('/image')) {
                const prompt = text.replace('/image', '').trim();
                handleImageGeneration(prompt);
                return;
            }

            const model = document.getElementById('modelSelector').value;
            const aiDiv = addMessage('ai', '', true);

            try {
                // Send activeImage context if available
                const payload = { message: text, model };
                if (activeImage) payload.image = activeImage;

                const res = await fetch('/api/chat', {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                aiDiv.innerHTML = '';

                while(true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\\n\\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if(data.token) aiDiv.innerHTML += formatToken(data.token);
                            } catch(e){}
                        }
                    }
                }
            } catch(e) { aiDiv.innerText = 'Error'; }
        }

        async function handleImageGeneration(prompt) {
            const style = document.getElementById('styleSelector').value;
            const aiDiv = addMessage('ai', 'Generating Image (' + style + ')...', true);
            try {
                const res = await fetch('/api/image', {
                     method: 'POST',
                     body: JSON.stringify({ prompt, style })
                });
                const data = await res.json();

                const id = 'img-' + Date.now();
                aiDiv.innerHTML = \`
                    <div class="flex flex-col gap-2">
                        <img src="\${data.image}" class="rounded border border-slate-600" id="\${id}">
                        <button onclick="saveImage('\${id}', '\${prompt}')" class="bg-indigo-600 text-xs py-1 px-2 text-white rounded self-end">Save</button>
                    </div>
                \`;
            } catch(e) { aiDiv.innerText = 'Generation Failed'; }
        }

        async function saveImage(id, prompt) {
            const img = document.getElementById(id);
            const base64 = img.src.split(',')[1];
            const name = \`assets/\${prompt.substring(0,10)}_\${Date.now()}.png\`.replace(/\\s/g, '_');
            await fetch('/api/fs/file', {
                method: 'POST',
                body: JSON.stringify({ name, content: base64 })
            });
            alert('Saved to ' + name);
            refreshFiles();
        }

        async function createNewFile() {
             const name = prompt("Filename:");
             if(name) {
                 await fetch('/api/fs/file', { method: 'POST', body: JSON.stringify({ name, content: '' }) });
                 refreshFiles();
             }
        }

        function addMessage(role, text, loading) {
            const div = document.createElement('div');
            div.className = \`chat-message p-3 rounded-lg border \${role === 'user' ? 'bg-slate-700/50 ml-6' : 'bg-indigo-900/20 mr-6'}\`;
            if(loading) div.innerHTML = 'Thinking...';
            else div.innerHTML = formatToken(text);
            chatMessages.appendChild(div);
            return div;
        }

        function formatToken(t) { return t.replace(/\\n/g, '<br>'); }
        function getLanguage(n) {
            if(n.endsWith('ts')) return 'typescript';
            if(n.endsWith('html')) return 'html';
            return 'plaintext';
        }
        async function uploadFile(input) {
            const file = input.files[0];
            if (!file) return;

            const aiDiv = addMessage('ai', 'Uploading: ' + file.name, true);

            try {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const base64 = e.target.result.split(',')[1];

                    const res = await fetch('/api/fs/file', {
                        method: 'POST',
                        body: JSON.stringify({
                            name: file.name,
                            content: base64,
                            encoding: 'base64'
                        })
                    });

                    if (res.ok) {
                        activeImage = file.name; // Set context for Vision
                        aiDiv.innerHTML = '✅ Uploaded <b>' + file.name + '</b>. <br><span class="text-xs opacity-50">Stored in R2. Ready for Vision.</span>';
                        refreshFiles();

                        // Auto-load if 3D
                        if (file.name.endsWith('.glb') || file.name.endsWith('.gltf')) {
                           openFile(file.name);
                        }
                    } else {
                        aiDiv.innerText = 'Upload Failed';
                    }
                };
                reader.readAsDataURL(file);
            } catch (e) {
                aiDiv.innerText = 'Error: ' + e.message;
            }
        }
    </script>
</body>
</html>`;
