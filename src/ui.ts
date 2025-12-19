export const IDE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Web IDE</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script type="importmap">
        {
            "imports": {
                "three": "https://unpkg.com/three@0.154.0/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.154.0/examples/jsm/"
            }
        }
    </script>
    <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.1.1/model-viewer.min.js"></script>
    <style>
        body { background: #0f172a; color: #f8fafc; overflow: hidden; font-family: 'Inter', sans-serif; }
        #monacoContainer { height: 100%; border-top: 1px solid #1e293b; }
        .tab-active { background: #1e293b; border-bottom: 2px solid #6366f1; }
        .sidebar-item:hover { background: #1e293b; }
        #chatMessages::-webkit-scrollbar { width: 4px; }
        #chatMessages::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
        .monaco-editor, .monaco-editor .margin, .monaco-editor-background { background-color: #0f172a !important; }
        .chat-message p { margin-bottom: 0.5rem; }
        .chat-message pre { background: #000; padding: 0.5rem; border-radius: 0.25rem; margin: 0.5rem 0; overflow-x: auto; }
        .chat-message code { font-family: monospace; color: #e2e8f0; }
    </style>
</head>
<body class="h-screen flex flex-col">
    <!-- Header -->
    <header class="h-12 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900/50 backdrop-blur-md">
        <div class="flex items-center gap-2">
            <i class="fa-solid fa-cloud-bolt text-indigo-500 text-xl"></i>
            <span class="font-bold tracking-tight">Cloudflare <span class="text-indigo-400">Code Agent</span></span>
            <div id="modeIndicator" class="ml-4 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                 Cloud Mode
            </div>
        </div>
        <div class="flex items-center gap-3">
             <button onclick="window.ghClone()" class="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-md border border-slate-700 transition flex items-center gap-2">
                <i class="fa-brands fa-github"></i> Clone
            </button>
            <button onclick="window.deployProject()" class="text-xs bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 rounded-md font-medium transition shadow-lg shadow-indigo-500/20">
                <i class="fa-solid fa-rocket mr-1"></i> Deploy
            </button>
        </div>
    </header>

    <main class="flex-1 flex overflow-hidden">
        <!-- Sidebar -->
        <aside class="w-64 border-r border-slate-800 flex flex-col bg-slate-900/20">
            <div class="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900/40">
                <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Explorer</span>
                <div class="flex gap-1">
                    <button onclick="window.createNewFile()" title="New File" class="p-1 hover:text-indigo-400 text-slate-500 transition"><i class="fa-solid fa-file-circle-plus text-sm"></i></button>
                    <button onclick="window.refreshFiles()" title="Refresh" class="p-1 hover:text-indigo-400 text-slate-500 transition"><i class="fa-solid fa-rotate text-sm"></i></button>
                    <label class="p-1 hover:text-indigo-400 text-slate-500 transition cursor-pointer">
                        <i class="fa-solid fa-upload text-sm"></i>
                        <input type="file" class="hidden" onchange="window.uploadFile(this)">
                    </label>
                </div>
            </div>
            <div id="fileList" class="flex-1 overflow-y-auto py-2">
                <!-- Files go here -->
            </div>

            <!-- GitHub Settings -->
            <div class="p-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
                <div class="flex items-center gap-2 truncate">
                    <i class="fa-solid fa-code-branch"></i>
                    <input id="ghRepo" type="text" placeholder="owner/repo" class="bg-transparent border-none outline-none w-full" value="">
                </div>
                <button onclick="window.toggleGithubSettings()" class="hover:text-slate-300"><i class="fa-solid fa-gear"></i></button>
            </div>
        </aside>

        <!-- Editor & Preview -->
        <section class="flex-1 flex flex-col min-w-0">
            <!-- Tabs -->
            <div id="tabsContainer" class="h-10 border-b border-slate-800 bg-slate-900/40 flex items-center overflow-x-auto overflow-y-hidden">
                <!-- Tabs go here -->
            </div>

            <!-- Active Editor / Media Container -->
            <div id="editorContainer" class="flex-1 relative">
                <div id="monacoContainer"></div>
                <!-- Media Overlay for images/3D -->
                <div id="previewContainer" class="absolute inset-0 z-10 bg-slate-900 hidden"></div>
            </div>

            <!-- Terminal (Collapsible) -->
            <div id="terminal" class="h-48 border-t border-slate-800 bg-[#0f171a] flex flex-col">
                <div class="px-3 py-1.5 border-b border-slate-800/50 flex items-center justify-between bg-black/20">
                    <div class="flex items-center gap-2 text-xs font-mono text-slate-400">
                        <i class="fa-solid fa-terminal text-emerald-500"></i>
                        <span>Terminal</span>
                    </div>
                </div>
                <div id="terminalOutput" class="flex-1 p-3 font-mono text-xs overflow-y-auto whitespace-pre-wrap text-slate-300"></div>
                <div class="p-2 border-t border-slate-800/50 flex">
                    <span class="text-emerald-500 font-mono text-xs mr-2">$</span>
                    <input id="terminalInput" type="text" class="flex-1 bg-transparent border-none outline-none font-mono text-xs text-white" placeholder="Run command...">
                </div>
            </div>
        </section>

        <!-- Chat Panel -->
        <aside class="w-80 border-l border-slate-800 flex flex-col bg-slate-900/30">
            <div class="p-3 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-sparkles text-indigo-400"></i>
                    <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">AI Assistant</span>
                </div>
                <div id="providerBadge" class="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">Llama 3.3</div>
            </div>

            <!-- Model Selector -->
            <div class="p-2 border-b border-slate-800">
                <select id="modelSelector" class="w-full bg-slate-800/50 border border-slate-700 text-xs p-1.5 rounded outline-none focus:border-indigo-500 transition">
                    <option value="default">Fast (Llama 3.3)</option>
                    <option value="thinking">Thinking (DeepSeek R1)</option>
                    <option value="flux">Image (FLUX.1)</option>
                </select>
            </div>

            <div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-4 text-sm text-slate-300">
                <div class="chat-message p-3 rounded-lg border border-slate-800 bg-slate-800/20">
                    Hello! I'm your AI coding agent. I can write code, run commands, and generate images.
                </div>
            </div>

            <div class="p-4 border-t border-slate-800">
                <div class="relative">
                    <textarea id="chatInput" rows="3" class="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-xs outline-none focus:border-indigo-500 transition resize-none pr-10" placeholder="Type a message or /image..."></textarea>
                    <button onclick="window.sendMessage()" class="absolute bottom-3 right-3 text-indigo-400 hover:text-indigo-300 transition">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </aside>
    </main>

    <!-- Modals -->
    <div id="diffModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm hidden flex items-center justify-center p-8">
        <div class="bg-slate-900 border border-slate-800 w-full max-w-6xl h-full flex flex-col rounded-xl shadow-2xl overflow-hidden">
            <div class="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                <h3 class="font-bold flex items-center gap-2">
                    <i class="fa-solid fa-code-compare text-indigo-400"></i>
                    Proposed Changes
                </h3>
                <div class="flex gap-2">
                    <button onclick="window.rejectDiff()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-md text-sm transition">Discard</button>
                    <button onclick="window.acceptDiff()" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-md text-sm font-bold transition shadow-lg shadow-indigo-500/20">Apply Changes</button>
                </div>
            </div>
            <div id="diffContainer" class="flex-1"></div>
        </div>
    </div>

    <!-- Status Bar -->
    <footer class="h-6 border-t border-slate-800 bg-slate-900 flex items-center justify-between px-3 text-[10px] text-slate-500">
        <div class="flex items-center gap-4">
            <div class="flex items-center gap-1"><i class="fa-solid fa-code-branch"></i> main</div>
            <div class="flex items-center gap-1"><i class="fa-solid fa-circle text-emerald-500 text-[6px]"></i> Ready</div>
        </div>
        <div class="flex items-center gap-4">
            <div id="cursorPos">Ln <span id="cursorLine">1</span>, Col <span id="cursorCol">1</span></div>
            <div class="flex items-center gap-1 font-mono uppercase tracking-widest opacity-80">UTF-8</div>
        </div>
    </footer>
</body></html>`;


export const UI_JS = `
// Global variables for the IDE state
let activeFile = null; // Currently active file name
let openTabs = []; // Array of file names
let fileTree = []; // Array representing the file system tree
let activeImage = null; // Track image context for Vision
let editor = null;
let currentCode = '';
let diffEditor = null;

// Helper: Escape string for JS inclusion
function escapeJsString(str) {
    if (!str) return '';
    return str.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'").replace(/"/g, '\\\\"').replace(/\\n/g, '\\\\n').replace(/\\r/g, '\\\\r');
}

// --- Deployment Logic ---
window.deployProject = async function() {
    const scriptName = prompt("Enter a unique name for your Cloudflare Worker app:", "my-awesome-agent");
    if (!scriptName) return;

    const btn = document.querySelector('button[onclick="window.deployProject()"]');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deploying...';
    if (btn instanceof HTMLButtonElement) btn.disabled = true;

    try {
        let codeToDeploy = currentCode;
        if (!activeFile?.endsWith('.ts') && !activeFile?.endsWith('.js')) {
             try {
                const res = await fetch('/api/fs/file?name=' + encodeURIComponent('src/index.ts'));
                if(res.ok) {
                    const d = await res.json();
                    codeToDeploy = d.content;
                }
             } catch(e) {}
        }

        if (!codeToDeploy) {
            alert("No code found to deploy! Open a .ts file first.");
            return;
        }

        const res = await fetch('/api/deploy', {
            method: 'POST',
            body: JSON.stringify({ scriptName, code: codeToDeploy })
        });
        const result = await res.json();

        if (res.ok) {
            alert(\`🚀 Success! Deployed to namespace '\${escapeJsString(result.result.namespace)}'.\\nScript: \${escapeJsString(result.result.script)}\`);
        } else {
             alert('Deployment Failed: ' + escapeJsString(result.error || 'Unknown Error'));
        }
    } catch (e) {
        alert('Deployment Error: ' + e.message);
    } finally {
        btn.innerHTML = originalText;
        if (btn instanceof HTMLButtonElement) btn.disabled = false;
    }
};

// --- Monaco Editor Setup ---
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});
require(['vs/editor/editor.main'], function(monacoInstance) {
    window.monaco = monacoInstance;
    monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
    });

    editor = monacoInstance.editor.create(document.getElementById('monacoContainer'), {
        value: '// Select a file to view content',
        language: 'typescript', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 13
    });

    editor.onDidChangeCursorPosition((e) => {
        document.getElementById('cursorLine').innerText = e.position.lineNumber;
        document.getElementById('cursorCol').innerText = e.position.column;
    });

    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
        if (activeFile) window.saveCurrentFile(activeFile, editor.getValue());
    });

    window.refreshFiles();
});

// --- Terminal Logic ---
const termInput = document.getElementById('terminalInput');
termInput?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
        const cmd = termInput.value;
        if (!cmd) return;
        termInput.value = '';
        const out = document.getElementById('terminalOutput');
        const line = document.createElement('div');
        line.innerHTML = '<span class="text-slate-500 mr-2">$</span>' + window.escapeHtml(cmd);
        out.appendChild(line);

        try {
            const res = await fetch('/api/terminal', { method: 'POST', body: JSON.stringify({ command: cmd }) });
            const d = await res.json();
            const respLine = document.createElement('pre');
            respLine.className = 'text-slate-300 whitespace-pre-wrap ml-4';
            respLine.innerText = d.output;
            out.appendChild(respLine);
        } catch (err) {
            const errLine = document.createElement('div');
                errLine.className = 'text-red-400 ml-4';
                errLine.innerText = 'Error: ' + err.message;
                out.appendChild(errLine);
        }
        out.scrollTop = out.scrollHeight;
    }
});

window.escapeHtml = function(text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

// --- GitHub Logic ---
window.toggleGithubSettings = function() {
    const current = localStorage.getItem('gh_token') || '';
    const token = prompt("Enter GitHub PAT:", current);
    if (token !== null) localStorage.setItem('gh_token', token);
};

window.ghClone = async function() {
    const repoInput = document.getElementById('ghRepo');
    const repo = repoInput?.value;
    const token = localStorage.getItem('gh_token');
    if (!repo || !token) return alert("Missing Repo or Token");

    const btn = document.querySelector('button[onclick="window.ghClone()"]');
    const oldText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const [owner, name] = repo.split('/');
        const res = await fetch('/api/github/clone', { method: 'POST', body: JSON.stringify({ token, owner, repo: name }) });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        alert('Cloned successfully');
        window.refreshFiles();
    } catch (e) {
        alert("Clone Failed: " + e.message);
    } finally { btn.innerHTML = oldText; }
};

// --- File Operations ---
window.refreshFiles = async function() {
    const listEl = document.getElementById('fileList');
    if (listEl) listEl.innerHTML = '<div class="text-slate-500 text-xs p-2">Loading...</div>';
    try {
        const res = await fetch('/api/fs/list');
        const files = await res.json();
        fileTree = files;
        window.renderFileList(files);
        if (!activeFile && files.length > 0) window.loadFile(files[0].name);
    } catch (e) { if (listEl) listEl.innerHTML = '<div class="text-red-400 text-xs p-2">Failed</div>'; }
};

window.renderFileList = function(files) {
    const listEl = document.getElementById('fileList');
    if (!listEl) return;
    listEl.innerHTML = '';
    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'group flex items-center justify-between px-3 py-1.5 text-slate-300 hover:bg-slate-700/50 cursor-pointer rounded-md';
        div.innerHTML = \`<div class="flex items-center gap-2 truncate flex-1" onclick="window.loadFile('\${escapeJsString(file.name)}')">
                            <i class="fa-regular fa-file-code text-slate-500 group-hover:text-indigo-400"></i>
                            <span>\${file.name}</span>
                        </div>
                        <button class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400" onclick="event.stopPropagation(); window.deleteFile('\${escapeJsString(file.name)}')"><i class="fa-solid fa-trash text-xs"></i></button>\`;
        listEl.appendChild(div);
    });
};

window.deleteFile = async function(name) {
    if (!confirm('Delete ' + name + '?')) return;
    try {
        await fetch('/api/fs/file?name=' + encodeURIComponent(name), { method: 'DELETE' });
        window.refreshFiles();
    } catch(e) { alert('Failed'); }
};

window.loadFile = async function(name) {
    activeFile = name;
    document.getElementById('activeFileName') ? document.getElementById('activeFileName').innerText = name : null;
    const container = document.getElementById('editorContainer');
    const previewContainer = document.getElementById('previewContainer');

    const isMedia = name.match(/\\\\.(png|jpg|glb|gltf)$/i);
    if (isMedia) {
        previewContainer.style.display = 'block';
        previewContainer.innerHTML = 'Loading...';
        const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
        if (name.match(/\\\\.(glb|gltf)$/i)) {
            const url = URL.createObjectURL(await res.blob());
            previewContainer.innerHTML = \`<model-viewer src="\${url}" camera-controls auto-rotate style="width:100%;height:100%"></model-viewer>\`;
        } else {
            const d = await res.json();
            previewContainer.innerHTML = \`<div class="flex items-center justify-center h-full bg-slate-900"><img src="\${d.content.startsWith('http') ? d.content : 'data:image/png;base64,' + d.content}" class="max-w-full max-h-full"></div>\`;
        }
    } else {
        previewContainer.style.display = 'none';
        try {
            const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
            const d = await res.json();
            currentCode = d.content;
            if (editor) {
                const model = editor.getModel();
                monaco.editor.setModelLanguage(model, window.getLanguage(name));
                editor.setValue(d.content);
            }
        } catch(e){}
    }
    window.renderTabs();
};

window.renderTabs = function() {
    if (!openTabs.includes(activeFile) && activeFile) openTabs.push(activeFile);
    const container = document.getElementById('tabsContainer');
    if (!container) return;
    container.innerHTML = '';
    openTabs.forEach(t => {
        const div = document.createElement('div');
        div.className = \`px-3 py-2 text-xs flex items-center gap-2 cursor-pointer \${t === activeFile ? 'bg-slate-800 border-t-2 border-indigo-500 text-slate-200' : 'bg-slate-900/50 text-slate-500'}\`;
        div.onclick = () => window.loadFile(t);
        div.innerHTML = \`<span>\${t}</span><i class="fa-solid fa-times hover:text-red-400" onclick="event.stopPropagation(); window.closeTab('\${escapeJsString(t)}')"></i>\`;
        container.appendChild(div);
    });
};

window.closeTab = function(name) {
    openTabs = openTabs.filter(t => t !== name);
    if (activeFile === name) activeFile = openTabs[openTabs.length - 1] || null;
    if (activeFile) window.loadFile(activeFile);
    else { if(editor) editor.setValue(''); window.renderTabs(); }
};

window.saveCurrentFile = async function(name, content) {
    if (editor && !name.match(/\\\\.(png|jpg|glb|gltf)$/i)) content = editor.getValue();
    await fetch('/api/fs/file', { method: 'POST', body: JSON.stringify({ name, content }) });
};

// --- AI Assistant ---
window.sendMessage = async function() {
    const input = document.getElementById('chatInput');
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';
    window.addMessage('user', text);
    const aiDiv = window.addMessage('ai', '', true);

    try {
        const model = document.getElementById('modelSelector')?.value;
        const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ message: text, model, image: activeImage }) });
        if (!res.ok) throw new Error('Status ' + res.status);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        aiDiv.innerHTML = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\\\\n\\\\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.token) aiDiv.innerHTML += window.formatToken(data.token);
                    } catch(e){}
                }
            }
        }
    } catch(e) { aiDiv.innerText = 'Error: ' + e.message; }
};

window.addMessage = function(role, text, loading) {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = \`p-3 rounded-lg border \${role === 'user' ? 'bg-slate-700/50 ml-6 border-slate-600' : 'bg-indigo-900/20 mr-6 border-indigo-900/50'}\`;
    div.innerHTML = loading ? 'Thinking...' : window.formatToken(text);
    container?.appendChild(div);
    container ? container.scrollTop = container.scrollHeight : null;
    return div;
};

window.formatToken = function(text) {
    const pattern = /\\\\x60\\\\x60\\\\x60(\\\\w+)?\\\\n(?:\\\\/\\\\/\\\\s*file:\\\\s*([^\\\\n\\\\r]+)\\\\n)?([\\\\s\\\\S]*?)\\\\x60\\\\x60\\\\x60/g;
    return text.replace(pattern, (m, lang, file, code) => {
        const encoded = encodeURIComponent(code);
        return \`<div class="bg-black/40 rounded p-2 my-2 border border-slate-700 relative group">
            <div class="flex justify-between text-[10px] text-slate-500 mb-1 uppercase">
                <span>\${file || lang || 'code'}</span>
                <button onclick="window.applyCode('\${encoded}', '\${file ? encodeURIComponent(file) : ''}')" class="text-indigo-400 hover:text-indigo-300 opacity-0 group-hover:opacity-100 transition">Apply</button>
            </div>
            <pre class="text-xs overflow-x-auto">\${window.escapeHtml(code)}</pre>
        </div>\`;
    }).replace(/\\\\n/g, '<br>');
};

window.applyCode = async function(encodedCode, file) {
    const code = decodeURIComponent(encodedCode);
    const fileName = file ? decodeURIComponent(file) : activeFile;
    if (fileName && fileName !== activeFile) await window.loadFile(fileName);
    if (!editor) return;
    const modal = document.getElementById('diffModal');
    modal?.classList.remove('hidden');
    if (!diffEditor) {
        diffEditor = monaco.editor.createDiffEditor(document.getElementById('diffContainer'), { theme: 'vs-dark', automaticLayout: true });
    }
    diffEditor.setModel({
        original: monaco.editor.createModel(editor.getValue(), 'typescript'),
        modified: monaco.editor.createModel(code, 'typescript')
    });
};

window.acceptDiff = function() {
    if (editor && diffEditor) {
        const val = diffEditor.getModel().modified.getValue();
        editor.setValue(val);
        if (activeFile) window.saveCurrentFile(activeFile, val);
    }
    window.rejectDiff();
};

window.rejectDiff = () => document.getElementById('diffModal')?.classList.add('hidden');
window.getLanguage = (n) => n.endsWith('ts') ? 'typescript' : (n.endsWith('html') ? 'html' : 'plaintext');

window.createNewFile = async function() {
    const name = prompt("Filename:");
    if (name) {
        await fetch('/api/fs/file', { method: 'POST', body: JSON.stringify({ name, content: '' }) });
        window.refreshFiles();
    }
};

window.uploadFile = async function(input) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = e.target.result.split(',')[1];
        await fetch('/api/fs/file', { method: 'POST', body: JSON.stringify({ name: file.name, content: base64, encoding: 'base64' }) });
        window.refreshFiles();
    };
    reader.readAsDataURL(file);
};
`;
