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
            <button onclick="window.runPreview()" class="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded text-sm transition-colors flex items-center space-x-2 shadow-lg shadow-indigo-500/20" title="Live Preview (HTML/JS)">
                <i class="fa-solid fa-play"></i> <span>Preview</span>
            </button>
            <button onclick="window.deployProject()" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-sm transition-colors flex items-center space-x-2 shadow-lg shadow-emerald-500/20">
                <i class="fa-solid fa-cloud-arrow-up"></i> <span>Deploy</span>
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
                    <button class="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition" onclick="window.refreshFiles()"><i class="fa-solid fa-rotate-right"></i></button>
                    <button class="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-700 transition" onclick="window.createNewFile()"><i class="fa-solid fa-plus"></i></button>
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
                <!-- Tabs rendered by JS -->
            </div>

            <div class="flex-1 relative group">
                <div id="monacoContainer" class="absolute inset-0"></div>
                <div id="previewContainer" class="absolute inset-0 hidden z-10 bg-slate-900"></div>
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
            <div class="p-3 bg-slate-800/80 border-t border-slate-700/50 backdrop-blur">
                <input type="file" id="visionInput" class="hidden" onchange="window.uploadFile(this)">
                <div class="relative flex items-center gap-2">
                    <button onclick="document.getElementById('visionInput').click()" class="text-slate-400 hover:text-indigo-400 transition-colors p-2 rounded-lg hover:bg-slate-700/50" title="Upload Image/File">
                        <i class="fa-solid fa-paperclip"></i>
                    </button>
                    <div class="relative flex-1">
                        <textarea id="chatInput" rows="1" class="w-full bg-slate-900 border border-slate-600 rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-none scroll-smooth transition-all" placeholder="Ask AI or type /image..."></textarea>
                        <button onclick="window.sendMessage()" class="absolute right-2 top-1.5 text-indigo-400 hover:text-indigo-300 p-1 transition-colors"><i class="fa-solid fa-paper-plane"></i></button>
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
    <script type="module" src="/ui.js"></script>
</body>
</html>`;

export const UI_JS = `// Helper function to escape strings for JavaScript literal insertion
function escapeJsString(str) {
    // Escapes single quotes and backslashes for insertion into a JavaScript string literal within HTML attributes.
    // Note: The '$' character does not need special escaping when injecting into a plain JS string literal.
    return str.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, '\\\\'');
}

// Global variables for the IDE state
// Global variables for the IDE state
let editor; // Monaco editor instance
let activeFile = null; // Currently active file name
let openTabs = []; // Array of file names
let fileTree = []; // Array representing the file system tree
let activeImage = null; // Track image context for Vision

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
        let codeToDeploy = '';
        if (editor) codeToDeploy = editor.getValue();

        // If editor is empty or not focused, try to fetch src/index.ts
        if ((!codeToDeploy || codeToDeploy.trim() === '') && !activeFile) {
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
            alert(\`🚀 Success! Deployed to namespace '\${escapeJsString(result.result.namespace)}'.\\nScript: \${escapeJsString(result.result.script)}\`);
        } else {
             alert('Deployment Failed: ' + escapeJsString(result.error || 'Unknown Error (Check Server Logs)'));
        }

    } catch (e) {
        alert('Deployment Error: ' + escapeJsString(e.message));
    }
    finally {
        btn.innerHTML = originalText;
        if (btn instanceof HTMLButtonElement) btn.disabled = false;
    }
}

// --- Monaco Editor Setup ---
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});

require(['vs/editor/editor.main'], function(monacoInstance) {
    window.monaco = monacoInstance; // Expose monaco globally

    monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
    });

    editor = monacoInstance.editor.create(document.getElementById('monacoContainer'), {
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
        const cursorLineElement = document.getElementById('cursorLine');
        const cursorColElement = document.getElementById('cursorCol');
        if (cursorLineElement) cursorLineElement.innerText = e.position.lineNumber;
        if (cursorColElement) cursorColElement.innerText = e.position.column;
    });

    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
        if (activeFile) window.saveCurrentFile(activeFile, editor.getValue());
    });

    window.refreshFiles();
});

const modelSelector = document.getElementById('modelSelector');
const providerBadge = document.getElementById('providerBadge');

modelSelector?.addEventListener('change', (e) => {
    const target = e.target;
    const isDeepSeek = target.value === 'thinking';
    if (providerBadge) {
        providerBadge.innerText = isDeepSeek ? 'DeepSeek R1' : 'Llama 3.3';
        providerBadge.className = isDeepSeek
            ? 'text-[10px] bg-indigo-900/50 text-indigo-300 ring-1 ring-indigo-500 px-1.5 py-0.5 rounded'
            : 'text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300';
    }
});

// --- File System Operations ---
window.refreshFiles = async function() {
    const listEl = document.getElementById('fileList');
    if (listEl) listEl.innerHTML = '<div class="text-slate-500 text-xs p-2">Loading...</div>';

    try {
        const res = await fetch('/api/fs/list');
        const uniqueFiles = new Map();
        (await res.json()).forEach((f) => uniqueFiles.set(f.name, f));
        const files = Array.from(uniqueFiles.values());
        fileTree = files;
        window.renderFileList(files);

        // Auto-open index.ts if nothing open
        if (!activeFile && files.find((f) => f.name === 'src/index.ts')) {
            window.loadFile('src/index.ts');
        }
    } catch (e) {
        if (listEl) listEl.innerHTML = '<div class="text-red-400 text-xs p-2">Failed</div>';
    }
};

window.renderFileList = function(files) {
    const listEl = document.getElementById('fileList');
    if (!listEl) return;

    listEl.innerHTML = '';
    files.sort((a, b) => a.name.localeCompare(b.name));

    files.forEach((file) => {
        const div = document.createElement('div');
        const isImg = file.name.match(new RegExp('\\.(png|jpg|jpeg|gif)$', 'i'));
        const is3D = file.name.match(new RegExp('\\.(glb|gltf)$', 'i'));

        let iconClass = 'fa-regular fa-file-code';
        if (isImg) iconClass = 'fa-regular fa-file-image';
        if (is3D) iconClass = 'fa-solid fa-cube text-indigo-400';

        div.className = 'group flex items-center justify-between px-3 py-1.5 text-slate-300 hover:bg-slate-700/50 cursor-pointer rounded-md transition-colors';
        div.innerHTML = '<div class="flex items-center gap-2 truncate flex-1" onclick="window.loadFile(\'' + escapeJsString(file.name) + '\')">' +
                        '<i class="' + iconClass + ' text-slate-500 group-hover:text-indigo-400 transition-colors text-xs"></i>' +
                        '<span>' + file.name + '</span>' +
                        '</div>' +
                        '<button class="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition p-1" onclick="event.stopPropagation(); window.deleteFile(\'' + escapeJsString(file.name) + '\')" title="Delete">' +
                        '<i class="fa-solid fa-trash text-xs"></i>' +
                        '</button>';
listEl.appendChild(div);
    });
};

window.deleteFile = async function (name) {
    if (!confirm('Are you sure you want to delete "' + name + '"?')) return;

    // Optimistic UI update
    const div = Array.from(document.querySelectorAll('#fileList > div')).find(d => d.innerText.includes(name));
    if (div) div.style.opacity = '0.5';

    try {
        await fetch('/api/fs/file?name=' + encodeURIComponent(name), { method: 'DELETE' });

        // Close tab if open
        if (openTabs.includes(name)) window.closeTab(name);

        window.refreshFiles();
    } catch (e) {
        alert('Delete failed: ' + e.message);
    }
};

window.runPreview = async function () {
    const previewContainer = document.getElementById('previewContainer');
    const monacoContainer = document.getElementById('monacoContainer');

    if (!previewContainer || !monacoContainer) return;

    // Toggle logic: If preview is visible, go back to code
    if (previewContainer.style.display === 'block' && !activeFile.match(/\.(png|jpg|glb|gltf)$/i)) {
        previewContainer.style.display = 'none';
        monacoContainer.style.display = 'block';
        return;
    }

    // Enter Preview Mode
    monacoContainer.style.display = 'none';
    previewContainer.style.display = 'block';
    previewContainer.innerHTML = '<div class="text-slate-500 p-4 text-center">Building Preview...</div>';

    // Gather all files to construct the preview
    // Simplistic approach: Inject raw HTML/CSS/JS into iframe
    try {
        let htmlContent = '<h1>No index.html found</h1>';

        // Find index.html
        if (fileTree.some(f => f.name === 'index.html')) {
            const res = await fetch('/api/fs/file?name=index.html');
            const d = await res.json();
            htmlContent = d.content;
        } else if (fileTree.some(f => f.name === 'src/index.html')) {
            const res = await fetch('/api/fs/file?name=src/index.html');
            const d = await res.json();
            htmlContent = d.content;
        } else {
            // If active file is HTML, use that
            if (activeFile && activeFile.endsWith('.html')) {
                const res = await fetch('/api/fs/file?name=' + encodeURIComponent(activeFile));
                const d = await res.json();
                htmlContent = d.content;
            }
        }

        const iframe = document.createElement('iframe');
        iframe.className = "w-full h-full bg-white border-none";
        previewContainer.innerHTML = '';
        previewContainer.appendChild(iframe);

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(htmlContent);
        doc.close();

    } catch (e) {
        previewContainer.innerHTML = '<div class="text-red-400 p-4">Preview Error: ' + e.message + '</div>';
    }
};

window.loadFile = async function (name) {
    // 1. Handle Tabs
    if (!openTabs.includes(name)) {
        openTabs.push(name);
    }
    activeFile = name;
    window.renderTabs();

    const monacoContainer = document.getElementById('monacoContainer');
    const previewContainer = document.getElementById('previewContainer');

    // 2. Handle Binary/Preview Files
    const is3D = name.match(new RegExp('\\.(glb|gltf)$', 'i'));
    const isImg = name.match(new RegExp('\\.(png|jpg|jpeg|gif)$', 'i'));

    if (is3D || isImg) {
        // Show Preview, Hide Editor
        if (monacoContainer) monacoContainer.style.display = 'none';
        if (previewContainer) {
            previewContainer.style.display = 'block';
            previewContainer.innerHTML = '<div class="flex items-center justify-center h-full text-slate-500">Loading Preview...</div>';

            try {
                const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));

                if (is3D) {
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    previewContainer.innerHTML = '<div class="h-full w-full bg-slate-900 relative">' +
                        '<model-viewer src="' + url + '" camera-controls auto-rotate shadow-intensity="1" style="width: 100%; height: 100%;" background-color="#1e293b"></model-viewer>' +
                        '<div class="absolute bottom-5 left-0 right-0 text-center pointer-events-none">' +
                        '<span class="bg-black/50 text-white px-2 py-1 rounded text-xs">3D Preview: ' + name + '</span>' +
                        '</div>' +
                        '</div>';
    } else {
    const data = await res.json();
    let src = data.content;
                if (!src.startsWith('data:') && !src.startsWith('http')) src = 'data:image/png;base64,' + data.content;
    activeImage = name;
                previewContainer.innerHTML = '<div class="h-full flex items-center justify-center bg-slate-900">' +
                    '<img src="' + src + '" class="max-w-[90%] max-h-[90%] shadow-lg border border-slate-700 rounded">' +
                    '</div>';
}
} catch (e) {
            previewContainer.innerHTML = '<div class="text-red-400 p-4">Error loading preview: ' + e.message + '</div>';
}
        }
return;
    }

// 3. Handle Code Files (Monaco)
if (monacoContainer) monacoContainer.style.display = 'block';
if (previewContainer) {
    // Only hide if we are NOT in special "Live Preview" mode?
    // For simplicity, always hide logic preview when clicking a code file.
    // User can click "Preview" button again to see it.
    previewContainer.style.display = 'none';
}

// Check if model already exists
const uri = monaco.Uri.parse('file:///' + name);
let model = monaco.editor.getModel(uri);

if (!model) {
    try {
        const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
        const data = await res.json();
        model = monaco.editor.createModel(data.content, getLanguage(name), uri);
    } catch (e) { }
}

if (editor && model) {
    editor.setModel(model);
}
};

window.renderTabs = function () {
    const tabsContainer = document.getElementById('tabsContainer');
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';

    openTabs.forEach(fileName => {
        const isActive = fileName === activeFile;
        // Styles: Active has top border + lighter bg. Inactive is darker.
        const tabClass = isActive
            ? 'px-3 py-2 bg-[#1e1e1e] border-t-2 border-indigo-500 text-slate-200 text-xs flex items-center space-x-2 min-w-fit cursor-pointer'
            : 'px-3 py-2 bg-[#2d2d2d] border-t-2 border-transparent text-slate-400 hover:bg-[#252525] text-xs flex items-center space-x-2 min-w-fit cursor-pointer transition-colors';

        const div = document.createElement('div');
        div.className = tabClass;
        div.onclick = () => window.loadFile(fileName);
        div.innerHTML = \`
            <span>\${fileName}</span>
            <button class="hover:text-red-400 ml-1 rounded-full p-0.5" onclick="event.stopPropagation(); window.closeTab('\${escapeJsString(fileName)}')" title="Close">
                <i class="fa-solid fa-times"></i>
            </button>
        \`;
        tabsContainer.appendChild(div);
    });
};

window.closeTab = function(name) {
    if (!name && activeFile) name = activeFile;
    if (!name) return;

    // Remove from openTabs
    openTabs = openTabs.filter(t => t !== name);

    // Dispose model to free memory? Or keep it?
    // Let's dispose if it's not the active file anymore to save memory,
    // OR keep it for "Gama" feel. Let's keep it for now (Browser Memory is cheap).
    // Actually, if we close the tab, users expect "Close".
    const uri = monaco.Uri.parse('file:///' + name);
    const model = monaco.editor.getModel(uri);
    if (model) model.dispose();

    // If we closed the active file, switch to neighbor
    if (activeFile === name) {
        activeFile = openTabs.length > 0 ? openTabs[openTabs.length - 1] : null;
        if (activeFile) {
            window.loadFile(activeFile);
        } else {
            // No tabs left
            editor.setModel(null); // Clear editor
            const previewContainer = document.getElementById('previewContainer');
            if (previewContainer) previewContainer.style.display = 'none';
             const monacoContainer = document.getElementById('monacoContainer');
            if (monacoContainer) monacoContainer.style.display = 'block';
            window.renderTabs();
        }
    } else {
        window.renderTabs();
    }
};

window.saveCurrentFile = async function(name, content) {
    // Content is ignored if using Monaco model, but kept for compatibility
    if (editor && !name.match(/\.(png|jpg|glb|gltf)$/i)) {
        const model = editor.getModel();
        content = model ? model.getValue() : content;
    }

    await fetch('/api/fs/file', {
        method: 'POST',
        body: JSON.stringify({ name, content })
    });
    // Visual feedback?
    const btn = document.querySelector('button[title="Save"]'); // If we had one
};

// --- Chat ---
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');

chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMessage(); }
});

window.sendMessage = async function() {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if(!text) return;
    chatInput.value = '';

    window.addMessage('user', text, false);

    if (text.startsWith('/image')) {
        const prompt = text.replace('/image', '').trim();
        window.handleImageGeneration(prompt);
        return;
    }
    const modelSelector = document.getElementById('modelSelector');
    const model = modelSelector ? modelSelector.value : 'default';

    const aiDiv = window.addMessage('ai', '', true);

    try {
        const payload = { message: text, model };
        if (activeImage) payload.image = activeImage;

        const res = await fetch('/api/chat', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const reader = res.body?.getReader();
        if (!reader) {
            aiDiv.innerText = 'Error: Could not get response reader.';
            return;
        }
        const decoder = new TextDecoder();
        aiDiv.innerHTML = '';

        while(true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\\n\\n'); // Split by actual newline characters
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if(data.token) aiDiv.innerHTML += window.formatToken(data.token);
                    } catch(e){}
                }
            }
        }
    } catch(e) {
        aiDiv.innerText = 'Error: ' + escapeJsString(e.message);
    }
};

window.handleImageGeneration = async function(prompt) {
    const styleSelector = document.getElementById('styleSelector');
    const style = styleSelector ? styleSelector.value : 'speed';
    const aiDiv = window.addMessage('ai', 'Generating Image (' + style + ')...', true);
    try {
        const res = await fetch('/api/image', {
             method: 'POST',
             body: JSON.stringify({ prompt, style })
        });
        const data = await res.json();

        const id = 'img-' + Date.now();
        aiDiv.innerHTML = \`<div class="flex flex-col gap-2">
                <img src="\${data.image}" class="rounded border border-slate-600" id="\${id}">
                <button onclick="window.saveImage('\${id}', '\${escapeJsString(prompt)}')" class="bg-indigo-600 text-xs py-1 px-2 text-white rounded self-end">Save</button>
            </div>\`;
    } catch(e) {
        aiDiv.innerText = 'Generation Failed: ' + escapeJsString(e.message);
    }
};

window.saveImage = async function(id, prompt) {
    const img = document.getElementById(id);
    if (!img) return;
    const base64 = img.src.split(',')[1];
    const name = \`assets/\${prompt.substring(0,10).replace(/\\s/g, '_')}_\${Date.now()}.png\`;
    await fetch('/api/fs/file', {
        method: 'POST',
        body: JSON.stringify({ name, content: base64 })
    });
    alert('Saved to ' + escapeJsString(name));
    window.refreshFiles();
};

window.createNewFile = async function() {
     const name = prompt("Filename:");
     if(name) {
         await fetch('/api/fs/file', { method: 'POST', body: JSON.stringify({ name, content: '' }) });
         window.refreshFiles();
     }
};

window.addMessage = function(role, text, loading) {
    const div = document.createElement('div');
    div.className = \`chat-message p-3 rounded-lg border \${role === 'user' ? 'bg-slate-700/50 ml-6' : 'bg-indigo-900/20 mr-6'}\`;
    if(loading) div.innerHTML = 'Thinking...';
    else div.innerHTML = window.formatToken(text);
    if (chatMessages) {
        chatMessages.appendChild(div);
    }
    return div;
};

window.applyCode = function(encodedCode) {
    if(!editor) return;
    const code = decodeURIComponent(encodedCode);
    const position = editor.getPosition();
    editor.executeEdits("ai-apply", [{
        range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        text: code,
        forceMoveMarkers: true
    }]);
};

window.formatToken = function(text) {
    // Regex for code blocks (using hex 60 for backtick to avoid string closure)
    const pattern = /\\x60\\x60\\x60(\\\w+)?\\\n([\\\s\\\S]*?)\\x60\\x60\\x60/g;
    text = text.replace(pattern, function(match, lang, code) {
        const encoded = encodeURIComponent(code);
        return \`<div class="bg-slate-900 rounded p-2 my-2 border border-slate-700 relative group">
                    <div class="flex justify-between items-center text-xs text-slate-500 mb-1">
                        <span>\${lang || 'code'}</span>
                        <button onclick="window.applyCode('\${encoded}')" class="text-indigo-400 hover:text-indigo-300 opacity-50 group-hover:opacity-100 transition"><i class="fa-solid fa-arrow-right-to-bracket"></i> Apply</button>
                    </div>
                    <pre class="overflow-x-auto text-xs text-slate-300 font-mono"><code>\${code}</code></pre>
                </div>\`;
    });

    // 2. Handle simple newlines
    return text.replace(/\\\n/g, '<br>');
};

window.getLanguage = function(n) {
    if(n.endsWith('ts')) return 'typescript';
    if(n.endsWith('html')) return 'html';
    return 'plaintext';
};

window.uploadFile = async function(input) {
    const file = input.files ? input.files[0] : null;
    if (!file) return;

    const aiDiv = window.addMessage('ai', 'Uploading: ' + file.name, true);

    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const result = e.target?.result;
            if (result === null || typeof result !== 'string') {
                aiDiv.innerText = 'Upload Failed: Could not read file content.';
                return;
            }
            const base64 = result.split(',')[1];

            const res = await fetch('/api/fs/file', {
                method: 'POST',
                body: JSON.stringify({
                    name: file.name,
                    content: base64,
                    encoding: 'base64'
                })
            });

            if (res.ok) {
                activeImage = file.name;
                aiDiv.innerHTML = \`✅ Uploaded <b>\${escapeJsString(file.name)}</b>. <br><span class="text-xs opacity-50">Stored in R2. Ready for Vision.</span>\`;
                window.refreshFiles();

                if (file.name.endsWith('.glb') || file.name.endsWith('.gltf')) {
                   window.loadFile(file.name);
                }
            } else {
                aiDiv.innerText = 'Upload Failed';
            }
        };
        reader.readAsDataURL(file);
    }
    catch (e) {
        aiDiv.innerText = 'Error: ' + escapeJsString(e.message);
    }
};

// --- Deployment Logic ---
window.deployProject = async function() {
    const scriptName = prompt("Enter a unique name for your Cloudflare Worker app:", "my-awesome-agent");
    if (!scriptName) return;

    const btn = document.querySelector('button[onclick="window.deployProject()"]');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deploying...';
    // Ensure btn is an HTMLButtonElement to access .disabled
    if (btn instanceof HTMLButtonElement) {
        btn.disabled = true;
    }

    try {
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
            alert(\`🚀 Success! Deployed to namespace '\${escapeJsString(result.result.namespace)}'.\\nScript: \${escapeJsString(result.result.script)}\`);
        } else {
             alert('Deployment Failed: ' + escapeJsString(result.error || 'Unknown Error (Check Server Logs)'));
        }

    } catch (e) {
        alert('Deployment Error: ' + escapeJsString(e.message));
    }
    finally {
        btn.innerHTML = originalText;
        if (btn instanceof HTMLButtonElement) {
            btn.disabled = false;
        }
    }
}

// --- Monaco Editor Setup ---
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});

require(['vs/editor/editor.main'], function(monacoInstance) {
    window.monaco = monacoInstance; // Expose monaco globally

    monacoInstance.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monacoInstance.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: monacoInstance.languages.typescript.ModuleResolutionKind.NodeJs,
    });

    editor = monacoInstance.editor.create(document.getElementById('editorContainer'), {
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
        const cursorLineElement = document.getElementById('cursorLine');
        const cursorColElement = document.getElementById('cursorCol');
        if (cursorLineElement) cursorLineElement.innerText = e.position.lineNumber;
        if (cursorColElement) cursorColElement.innerText = e.position.column;
    });

    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
        window.saveCurrentFile(activeFile, editor.getValue());
    });

    window.refreshFiles();
});

const modelSelector = document.getElementById('modelSelector');
const providerBadge = document.getElementById('providerBadge');

modelSelector?.addEventListener('change', (e) => {
    const target = e.target;
    const isDeepSeek = target.value === 'thinking';
    if (providerBadge) {
        providerBadge.innerText = isDeepSeek ? 'DeepSeek R1' : 'Llama 3.3';
        providerBadge.className = isDeepSeek
            ? 'text-[10px] bg-indigo-900/50 text-indigo-300 ring-1 ring-indigo-500 px-1.5 py-0.5 rounded'
            : 'text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300';
    }
});

// --- File System Operations ---
window.refreshFiles = async function() {
    const listEl = document.getElementById('fileList');
    if (listEl) {
        listEl.innerHTML = '<div class="text-slate-500 text-xs p-2">Loading...</div>';
    }
    try {
        const res = await fetch('/api/fs/list');
        const uniqueFiles = new Map();
        (await res.json()).forEach((f) => uniqueFiles.set(f.name, f));
        const files = Array.from(uniqueFiles.values());

        fileTree = files;
        window.renderFileList(files);

        if (activeFile === 'loading...' && files.find((f) => f.name === 'src/index.ts')) {
            window.loadFile('src/index.ts');
        }
    } catch (e) {
        if (listEl) {
            listEl.innerHTML = '<div class="text-red-400 text-xs p-2">Failed</div>';
        }
    }
};

window.renderFileList = function(files) {
    const listEl = document.getElementById('fileList');
    if (!listEl) return;

    listEl.innerHTML = '';
    files.sort((a, b) => a.name.localeCompare(b.name));

    files.forEach((file) => {
        const div = document.createElement('div');
        const isImg = file.name.match(new RegExp('\\.(png|jpg|jpeg|gif)$', 'i'));
        const is3D = file.name.match(new RegExp('\\.(glb|gltf)$', 'i'));

        let iconClass = 'fa-regular fa-file-code';
        if (isImg) iconClass = 'fa-regular fa-file-image';
        if (is3D) iconClass = 'fa-solid fa-cube text-indigo-400';

        div.className = 'group flex items-center justify-between px-3 py-1.5 text-slate-300 hover:bg-slate-700/50 cursor-pointer rounded-md transition-colors';
        div.innerHTML = \`<div class="flex items-center gap-2 truncate" onclick="window.loadFile('\${escapeJsString(file.name)}')">
                            <i class="\${iconClass} text-slate-500 group-hover:text-indigo-400 transition-colors text-xs"></i>
                            <span>\${file.name}</span>
                        </div>\`;
        listEl.appendChild(div);
    });
};

window.loadFile = async function(name) {
    activeFile = name;
    const activeFileNameElement = document.getElementById('activeFileName');
    if (activeFileNameElement) {
        activeFileNameElement.innerText = name;
    }
    const container = document.getElementById('editorContainer');
    if (!container) return;

    // 3D Preview
    if (name.match(new RegExp('\\.(glb|gltf)$', 'i'))) {
         activeImage = null;
         const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
         const blob = await res.blob();
         const url = URL.createObjectURL(blob);

         container.innerHTML = \`<div class="h-full w-full bg-slate-900 relative">
        <model-viewer
src="\${url}"
id="mv-viewer"
camera-controls
auto-rotate
shadow-intensity="1"
style="width: 100%; height: 100%;"
alt="A 3D model"
background-color="#1e293b"
    ></model-viewer>
    <div class="absolute bottom-5 left-0 right-0 text-center pointer-events-none">
        <span class="bg-black/50 text-white px-2 py-1 rounded text-xs">3D Preview: \${name}</span>
            </div>
            </div>\`;
         return;
    }

    // Image Preview
    if (name.match(new RegExp('\\.(png|jpg)$', 'i'))) {
         activeImage = name;
         const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
         const data = await res.json();
         let src = data.content;
         if (!src.startsWith('data:') && !src.startsWith('http')) {
             src = \`data:image/png;base64,\${data.content}\`;
         }

         container.innerHTML = \`<div class="h-full flex items-center justify-center bg-slate-900">
                        <img src="\${src}" class="max-w-[90%] max-h-[90%] shadow-lg border border-slate-700 rounded">
                    </div>\`;
         return;
    }

// Code/Text
if (!container.querySelector('.monaco-editor')) {
    location.reload();
    return;
}

try {
    const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
                const data = await res.json();
                currentCode = data.content;
                if (editor) {
                    const model = editor.getModel();
                    if (window.monaco && model) {
                        window.monaco.editor.setModelLanguage(model, getLanguage(name));
                    }
                    editor.setValue(data.content);
                }
            } catch (e) { }
        };

window.saveCurrentFile = async function(name, content) {
    await fetch('/api/fs/file', {
        method: 'POST',
        body: JSON.stringify({ name, content })
    });
    window.refreshFiles();
};

// --- Chat ---
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');

chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.sendMessage(); }
});

window.sendMessage = async function() {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if(!text) return;
    chatInput.value = '';

    window.addMessage('user', text, false);

    if (text.startsWith('/image')) {
        const prompt = text.replace('/image', '').trim();
        window.handleImageGeneration(prompt);
        return;
    }
    const modelSelector = document.getElementById('modelSelector');
    const model = modelSelector ? modelSelector.value : 'default';

    const aiDiv = window.addMessage('ai', '', true);

    try {
        const payload = { message: text, model };
        if (activeImage) payload.image = activeImage;

        const res = await fetch('/api/chat', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        const reader = res.body?.getReader();
        if (!reader) {
            aiDiv.innerText = 'Error: Could not get response reader.';
            return;
        }
        const decoder = new TextDecoder();
        aiDiv.innerHTML = '';

        while(true) {
const { done, value } = await reader.read();
if (done) break;
const chunk = decoder.decode(value);
const lines = chunk.split('\\n\\n'); // Split by actual newline characters
for (const line of lines) {
    if (line.startsWith('data: ')) {
        try {
                        const data = JSON.parse(line.slice(6));
                        if(data.token) aiDiv.innerHTML += window.formatToken(data.token);
                    } catch(e){}
                }
            }
        }
    } catch(e) {
        aiDiv.innerText = 'Error: ' + escapeJsString(e.message);
    }
};

window.handleImageGeneration = async function(prompt) {
    const styleSelector = document.getElementById('styleSelector');
    const style = styleSelector ? styleSelector.value : 'speed';
    const aiDiv = window.addMessage('ai', 'Generating Image (' + style + ')...', true);
    try {
        const res = await fetch('/api/image', {
             method: 'POST',
             body: JSON.stringify({ prompt, style })
        });
        const data = await res.json();

        const id = 'img-' + Date.now();
        aiDiv.innerHTML = \`<div class="flex flex-col gap-2">
                <img src="\${data.image}" class="rounded border border-slate-600" id="\${id}">
                <button onclick="window.saveImage('\${id}', '\${escapeJsString(prompt)}')" class="bg-indigo-600 text-xs py-1 px-2 text-white rounded self-end">Save</button>
            </div>\`;
    } catch(e) {
        aiDiv.innerText = 'Generation Failed: ' + escapeJsString(e.message);
    }
};

window.saveImage = async function(id, prompt) {
    const img = document.getElementById(id);
    if (!img) return;
    const base64 = img.src.split(',')[1];
    const name = \`assets/\${prompt.substring(0,10).replace(/\\s/g, '_')}_\${Date.now()}.png\`;
    await fetch('/api/fs/file', {
        method: 'POST',
        body: JSON.stringify({ name, content: base64 })
    });
    alert('Saved to ' + escapeJsString(name));
    window.refreshFiles();
};

window.createNewFile = async function() {
     const name = prompt("Filename:");
     if(name) {
         await fetch('/api/fs/file', { method: 'POST', body: JSON.stringify({ name, content: '' }) });
         window.refreshFiles();
     }
};

window.closeTab = function() {
    activeFile = 'No file selected';
    if(editor) editor.setValue('// Select a file to view content');
    const activeFileNameElement = document.getElementById('activeFileName');
    if (activeFileNameElement) activeFileNameElement.innerText = activeFile;
    const container = document.getElementById('editorContainer');
     if (container) {
        // Ensure monaco container exists if it was replaced by 3D/Image
        if (!container.querySelector('.monaco-editor')) {
             location.reload(); // Simple reset for now if coming from 3D view
        }
    }
};

window.addMessage = function(role, text, loading) {
    const div = document.createElement('div');
    div.className = \`chat-message p-3 rounded-lg border \${role === 'user' ? 'bg-slate-700/50 ml-6' : 'bg-indigo-900/20 mr-6'}\`;
    if(loading) div.innerHTML = 'Thinking...';
    else div.innerHTML = window.formatToken(text);
    if (chatMessages) {
        chatMessages.appendChild(div);
    }
    return div;
};

window.applyCode = function(encodedCode) {
    if(!editor) return;
    const code = decodeURIComponent(encodedCode);
    const position = editor.getPosition();
    editor.executeEdits("ai-apply", [{
        range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
        text: code,
        forceMoveMarkers: true
    }]);
};

window.formatToken = function(text) {
    // 1. Handle Code Blocks
    // Regex for code blocks (using hex 60 for backtick to avoid string closure)
    const pattern = /\\x60\\x60\\x60(\\\w+)?\\\n([\\\s\\\S]*?)\\x60\\x60\\x60/g;
    text = text.replace(pattern, function(match, lang, code) {
        const encoded = encodeURIComponent(code);
        return \`<div class="bg-slate-900 rounded p-2 my-2 border border-slate-700 relative group">
                    <div class="flex justify-between items-center text-xs text-slate-500 mb-1">
                        <span>\${lang || 'code'}</span>
                        <button onclick="window.applyCode('\${encoded}')" class="text-indigo-400 hover:text-indigo-300 opacity-50 group-hover:opacity-100 transition"><i class="fa-solid fa-arrow-right-to-bracket"></i> Apply</button>
                    </div>
                    <pre class="overflow-x-auto text-xs text-slate-300 font-mono"><code>\${code}</code></pre>
                </div>\`;
    });

    // 2. Handle simple newlines
    return text.replace(/\\\n/g, '<br>');
};

window.getLanguage = function(n) {
    if(n.endsWith('ts')) return 'typescript';
    if(n.endsWith('html')) return 'html';
    return 'plaintext';
};

window.uploadFile = async function(input) {
    const file = input.files ? input.files[0] : null;
    if (!file) return;

    const aiDiv = window.addMessage('ai', 'Uploading: ' + file.name, true);

    try {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const result = e.target?.result;
            if (result === null || typeof result !== 'string') {
                aiDiv.innerText = 'Upload Failed: Could not read file content.';
                return;
            }
            const base64 = result.split(',')[1];

            const res = await fetch('/api/fs/file', {
                method: 'POST',
                body: JSON.stringify({
                    name: file.name,
                    content: base64,
                    encoding: 'base64'
                })
            });

            if (res.ok) {
                activeImage = file.name;
                aiDiv.innerHTML = \`✅ Uploaded <b>\${escapeJsString(file.name)}</b>. <br><span class="text-xs opacity-50">Stored in R2. Ready for Vision.</span>\`;
                window.refreshFiles();

                if (file.name.endsWith('.glb') || file.name.endsWith('.gltf')) {
                   window.loadFile(file.name);
                }
            } else {
                aiDiv.innerText = 'Upload Failed';
            }
        };
        reader.readAsDataURL(file);
    }
    catch (e) {
        aiDiv.innerText = 'Error: ' + escapeJsString(e.message);
    }
};
`;
