export const IDE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare Web IDE</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.min.js"></script>
    <script type="importmap">
        {
            "imports": {
                "three": "https://unpkg.com/three@0.154.0/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.154.0/examples/jsm/"
            }
        }
    </script>
    <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.1.1/model-viewer.min.js"></script>
    <script>
      // Silence Tailwind Production Warning
      window.tailwind = { config: { silent: true } };
      localStorage.setItem('tailwind-config-warn', 'false');
    </script>
    <style>
        body { background: #020617; color: #f8fafc; overflow: hidden; font-family: 'Inter', sans-serif; position: relative; }
        body::before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 50% -20%, rgba(34, 211, 238, 0.05), transparent 60%); pointer-events: none; }
        #monacoContainer { height: 100%; border-top: 1px solid #1e293b; }
        .tab-active { background: #083344; border-bottom: 2px solid #22d3ee; box-shadow: 0 4px 12px -2px rgba(34, 211, 238, 0.2); }
        .sidebar-item:hover { background: #083344; color: #22d3ee; }
        #chatMessages::-webkit-scrollbar { width: 4px; }
        #chatMessages::-webkit-scrollbar-thumb { background: #164e63; border-radius: 2px; }
        .monaco-editor, .monaco-editor .margin, .monaco-editor-background { background-color: #020617 !important; }
        .chat-message p { margin-bottom: 0.5rem; }
        .chat-message pre { background: #000; padding: 0.5rem; border-radius: 0.25rem; margin: 0.5rem 0; overflow-x: auto; border: 1px solid #164e63; }
        .chat-message code { font-family: monospace; color: #22d3ee; }
        .gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.5rem; padding: 0.5rem; }
        .asset-card { background: #0f172a; border-radius: 0.5rem; border: 1px solid #1e293b; overflow: hidden; position: relative; aspect-ratio: 1/1; cursor: pointer; transition: all 0.2s; }
        .asset-card:hover { border-color: #22d3ee; transform: translateY(-2px); box-shadow: 0 0 15px rgba(34, 211, 238, 0.3); }
        .asset-thumb { width: 100%; height: 100%; object-fit: cover; }
        .asset-meta { position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(0,0,0,0.8)); padding: 0.25rem 0.5rem; font-size: 8px; color: #94a3b8; pointer-events: none; }
        .glow-text { text-shadow: 0 0 10px rgba(34, 211, 238, 0.4); }
        .neon-border { border-color: #22d3ee; box-shadow: 0 0 10px rgba(34, 211, 238, 0.2); }
    </style>
</head>
<body class="h-screen flex flex-col">
    <!-- Header -->
    <header class="h-12 border-b border-cyan-900/50 flex items-center justify-between px-4 bg-slate-950/80 backdrop-blur-md relative z-20">
        <div class="flex items-center gap-2">
            <i class="fa-solid fa-cloud-bolt text-cyan-400 text-xl glow-text"></i>
            <span class="font-bold tracking-tight glow-text text-slate-100">Cloudflare <span class="text-cyan-400">Code Agent</span></span>
            <div id="modeIndicator" class="ml-4 text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_8px_rgba(34,211,238,0.1)]">
                 Neon Drive
            </div>
        </div>
        <div class="flex items-center gap-3">
             <button onclick="window.ghClone()" class="text-xs bg-slate-900 hover:bg-cyan-900/30 px-3 py-1.5 rounded-md border border-cyan-900/50 transition flex items-center gap-2 text-slate-300 hover:text-cyan-400 group">
                <i class="fa-brands fa-github group-hover:scale-110 transition"></i> Clone
            </button>
            <button onclick="window.deployProject()" class="text-xs bg-cyan-600 hover:bg-cyan-500 px-4 py-1.5 rounded-md font-bold transition shadow-lg shadow-cyan-500/20 text-white uppercase tracking-wider">
                <i class="fa-solid fa-rocket mr-1"></i> Deploy
            </button>
        </div>
    </header>

    <main class="flex-1 flex overflow-hidden">
        <!-- Sidebar -->
        <aside class="w-64 border-r border-cyan-900/50 flex flex-col bg-slate-950/80 transition-all duration-300 ease-in-out group/sidebar overflow-hidden relative z-20">
            <div class="p-3 border-b border-cyan-900/30 flex justify-between items-center bg-cyan-950/20">
                <span class="text-[10px] font-bold text-cyan-700 uppercase tracking-widest">Navigation</span>
                <div class="flex gap-1">
                    <button onclick="window.toggleExplorerMode()" id="explorerToggle" title="Toggle Gallery" class="p-1 hover:text-cyan-400 text-cyan-900 transition"><i class="fa-solid fa-table-cells text-sm"></i></button>
                    <button onclick="window.toggleAudioStudio()" id="audioStudioToggle" title="Sound Studio" class="p-1 hover:text-cyan-400 text-cyan-900 transition"><i class="fa-solid fa-microphone-lines text-sm"></i></button>
                    <button onclick="window.toggleBible()" id="bibleToggle" title="Project Lore" class="p-1 hover:text-cyan-400 text-cyan-900 transition"><i class="fa-solid fa-book text-sm"></i></button>
                    <button onclick="window.createNewFile()" title="New File" class="p-1 hover:text-cyan-400 text-cyan-900 transition"><i class="fa-solid fa-file-circle-plus text-sm"></i></button>
                    <button onclick="window.refreshFiles()" title="Refresh" class="p-1 hover:text-cyan-400 text-cyan-900 transition"><i class="fa-solid fa-rotate text-sm"></i></button>
                    <label class="p-1 hover:text-cyan-400 text-cyan-900 transition cursor-pointer">
                        <i class="fa-solid fa-upload text-sm"></i>
                        <input type="file" class="hidden" onchange="window.uploadFile(this)">
                    </label>
                </div>
            </div>
            <div id="fileList" class="flex-1 overflow-y-auto py-2 bg-slate-950/40">
                <!-- Files go here -->
            </div>
            <div id="galleryList" class="flex-1 overflow-y-auto hidden bg-slate-950/40">
                <div class="gallery-grid" id="galleryGrid"></div>
            </div>
            <div id="biblePanel" class="flex-1 overflow-y-auto hidden p-3 bg-slate-950/40">
                <div class="flex gap-2 mb-4">
                    <button onclick="window.showBibleTab('lore')" class="text-[10px] uppercase font-bold text-cyan-400 border-b border-cyan-500 pb-1">Lore</button>
                    <button onclick="window.showBibleTab('tasks')" class="text-[10px] uppercase font-bold text-cyan-900 hover:text-cyan-600 pb-1">Tasks</button>
                </div>
                <div id="bibleContent" class="text-xs text-cyan-100/70 font-mono">
                    <div id="loreWiki" class="prose prose-invert prose-xs">Open BIBLE_LORE.md to begin.</div>
                    <div id="kanbanBoard" class="hidden space-y-4">
                        <div class="kanban-col"><h4 class="text-[8px] uppercase text-cyan-900 mb-2 border-b border-cyan-950 pb-1">Backlog</h4><div id="todoList"></div></div>
                        <div class="kanban-col"><h4 class="text-[8px] uppercase text-cyan-500 mb-2 border-b border-cyan-900/20 pb-1">Active</h4><div id="doingList"></div></div>
                        <div class="kanban-col"><h4 class="text-[8px] uppercase text-cyan-700 mb-2 border-b border-cyan-900/10 pb-1">Finalized</h4><div id="doneList"></div></div>
                    </div>
                </div>
            </div>
            <div id="audioStudioPanel" class="flex-1 overflow-y-auto hidden p-3 bg-slate-950/40">
                <h3 class="text-[10px] uppercase font-bold text-cyan-700 mb-4 tracking-widest">Vocal Synthesis</h3>
                <div class="space-y-4">
                    <div>
                        <textarea id="audioInput" rows="4" class="w-full bg-slate-900 border border-cyan-900/50 text-xs p-2 rounded outline-none focus:border-cyan-400 transition text-cyan-100 placeholder:text-cyan-900" placeholder="Source Text..."></textarea>
                    </div>
                    <select id="audioModel" class="w-full bg-slate-900 border border-cyan-900/50 text-xs p-1.5 rounded outline-none focus:border-cyan-400 transition text-cyan-400">
                        <option value="aura">Aura (Default)</option>
                        <option value="melo">Melo (Fast)</option>
                    </select>
                    <button onclick="window.generateAudio()" id="generateAudioBtn" class="w-full bg-cyan-600 hover:bg-cyan-500 text-white text-xs py-2 rounded font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/10">
                        <i class="fa-solid fa-wand-sparkles"></i> Synthesize
                    </button>
                    <div id="audioPreview" class="hidden border-t border-cyan-900/30 pt-4 mt-4">
                        <audio id="previewPlayer" controls class="w-full h-8 mb-4 opacity-50"></audio>
                        <div class="flex gap-2">
                            <input id="audioName" type="text" placeholder="output.mp3" class="flex-1 bg-slate-900 border border-cyan-900/50 text-xs px-2 py-1.5 rounded text-white italic outline-none focus:border-cyan-400">
                            <button onclick="window.saveGeneratedAudio()" class="bg-cyan-900/50 hover:bg-cyan-800 text-cyan-400 text-[10px] px-3 py-1.5 rounded font-bold border border-cyan-400/20 uppercase">Save</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- GitHub Settings -->
            <div class="p-3 border-t border-cyan-900/50 flex flex-col gap-2 bg-slate-950">
                <div class="flex items-center justify-between text-[10px] text-cyan-900 font-mono">
                    <span class="truncate max-w-[100px]" id="ghRepoStatus">Not Linked</span>
                    <button onclick="window.toggleGithubSettings()" class="hover:text-cyan-400 transition"><i class="fa-solid fa-gear"></i></button>
                </div>
            </div>
        </aside>

        <!-- Editor & Preview -->
        <section class="flex-1 flex flex-col min-w-0 bg-[#020617]">
            <!-- Tabs -->
            <div id="tabsContainer" class="h-9 flex bg-slate-950 border-b border-cyan-900/20 overflow-x-auto scrollbar-hide"></div>

            <!-- Active Editor / Media Container -->
            <div id="editorContainer" class="flex-1 relative">
                <div id="monacoContainer"></div>
                <!-- Media Overlay for images/3D -->
                <div id="previewContainer" class="absolute inset-0 z-10 bg-slate-950 hidden"></div>
            </div>

            <!-- Terminal (Collapsible) -->
            <div id="terminal" class="h-48 border-t border-cyan-900/50 bg-[#010409] flex flex-col relative z-20">
                <div class="px-3 py-1.5 border-b border-cyan-900/10 flex items-center justify-between bg-black/40">
                    <div class="flex items-center gap-2 text-xs font-mono text-cyan-900">
                        <i class="fa-solid fa-terminal"></i>
                        <span class="tracking-widest">Command Interface</span>
                    </div>
                </div>
                <div id="terminalOutput" class="flex-1 p-3 font-mono text-xs overflow-y-auto whitespace-pre-wrap text-cyan-700/80"></div>
                <div class="p-2 border-t border-cyan-900/10 flex bg-black/20">
                    <span class="text-cyan-600 font-mono text-xs mr-2 animate-pulse">>>></span>
                    <input id="terminalInput" type="text" class="flex-1 bg-transparent border-none outline-none font-mono text-xs text-cyan-400 placeholder:text-cyan-950" placeholder="System Input...">
                </div>
            </div>
        </section>

        <!-- Chat Panel -->
        <aside class="w-80 border-l border-cyan-900/50 flex flex-col bg-slate-950/90 backdrop-blur-sm z-20 shadow-[-20px_0_50px_rgba(0,0,0,0.5)]">
            <div class="p-3 border-b border-cyan-900/50 bg-cyan-950/10 flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <i class="fa-solid fa-sparkles text-cyan-400 glow-text"></i>
                    <span class="text-xs font-bold uppercase tracking-[0.2em] text-cyan-500">Nova Core v4</span>
                </div>
                <div id="providerBadge" class="text-[8px] bg-cyan-900/30 px-2 py-0.5 rounded border border-cyan-500/10 text-cyan-700 tracking-widest font-mono">LINKED</div>
            </div>

            <!-- Model Selector -->
            <div class="p-2 border-b border-cyan-900/20 bg-black/10">
                <select id="modelSelector" class="w-full bg-slate-950 border border-cyan-900/40 text-[10px] p-2 rounded outline-none focus:border-cyan-400 transition text-cyan-500 font-mono uppercase tracking-wider">
                    <optgroup label="Neural Reasoning" class="bg-slate-950 text-cyan-400">
                        <option value="gpt_oss">GPT-OSS 120B</option>
                        <option value="llama4_scout">Llama 4 Scout</option>
                        <option value="reasoning">DeepSeek R1</option>
                        <option value="qwq_32b">QwQ 32B (Thinking)</option>
                    </optgroup>
                    <optgroup label="Logic Engines" class="bg-slate-950">
                        <option value="coding" selected>Qwen 2.5 Coding</option>
                        <option value="default">Llama 3.3 Turbo</option>
                        <option value="mistral_small">Mistral Small</option>
                        <option value="gemma_3">Gemma 3</option>
                    </optgroup>
                    <optgroup label="External Clusters" class="bg-slate-950">
                        <option value="kimi">Kimi K1.5</option>
                        <option value="gpt4o">GPT-4o (Elite)</option>
                        <option value="claude3">Claude 3.5</option>
                    </optgroup>
                </select>
            </div>

            <div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-cyan-100/60 bg-[#020617]/50 scrollbar-hide">
                <div class="chat-message p-3 rounded-lg border border-cyan-950 bg-cyan-950/5 text-cyan-700 italic font-mono">
                    [SYSTEM] Neural link established. Waiting for directive...
                </div>
            </div>

            <div class="p-4 border-t border-cyan-900/50 bg-slate-950">
                <div class="flex items-center gap-2 mb-3 px-1">
                    <button id="voiceBtn"
                        onmousedown="window.startSpeechToText()"
                        onmouseup="window.stopSpeechToText()"
                        onmouseleave="window.stopSpeechToText()"
                        ontouchstart="event.preventDefault(); window.startSpeechToText()"
                        ontouchend="event.preventDefault(); window.stopSpeechToText()"
                        class="p-2 rounded-full bg-slate-900 hover:bg-cyan-900/40 text-cyan-900 hover:text-cyan-400 border border-cyan-900/20 transition-all shadow-glow"
                        title="Voice Interface">
                        <i class="fa-solid fa-microphone-slash"></i>
                    </button>
                    <button id="audioToggle" onclick="window.toggleAutoAudio()" class="p-2 rounded-full bg-slate-900 hover:bg-cyan-900/40 text-cyan-900 hover:text-cyan-400 border border-cyan-900/20 transition-all" title="Audio Feedback">
                        <i class="fa-solid fa-satellite-dish"></i>
                    </button>
                    <div id="voiceStatus" class="hidden text-[8px] text-cyan-500 animate-pulse font-mono tracking-widest uppercase">Intercepting...</div>
                </div>
                <div class="relative group">
                    <textarea id="chatInput" class="w-full bg-[#010409] border border-cyan-900/40 rounded p-3 pr-12 text-xs focus:border-cyan-400 outline-none resize-none text-cyan-100 placeholder:text-cyan-900 transition-all shadow-inner font-mono" placeholder="Input directive..." rows="3"></textarea>
                    <button id="chatSendButton" class="absolute bottom-4 right-3 p-2 text-cyan-900 group-focus-within:text-cyan-400 hover:scale-110 transition-all">
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
            </div>
        </aside>
    </main>

    <!-- Modals -->
    <div id="diffModal" class="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl hidden flex items-center justify-center p-8">
        <div class="bg-slate-950 border border-cyan-500/20 w-full max-w-6xl h-full flex flex-col rounded shadow-[0_0_100px_rgba(34,211,238,0.1)] overflow-hidden">
            <div class="p-4 border-b border-cyan-900/30 flex justify-between items-center bg-cyan-950/20">
                <h3 class="font-bold flex items-center gap-3 text-cyan-400 tracking-widest uppercase text-xs font-mono">
                    <i class="fa-solid fa-code-compare animate-pulse"></i>
                    Merge Consensus Required
                </h3>
                <div class="flex gap-2">
                    <button onclick="window.rejectDiff()" class="px-4 py-1.5 bg-slate-900 hover:bg-cyan-900/20 rounded text-[10px] uppercase font-bold text-cyan-900 hover:text-cyan-400 transition border border-cyan-900/30">Abort</button>
                    <button onclick="window.acceptDiff()" class="px-6 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded text-[10px] uppercase font-bold text-white transition shadow-lg shadow-cyan-500/20 tracking-widest">Commit</button>
                </div>
            </div>
            <div id="diffContainer" class="flex-1"></div>
        </div>
    </div>

    <!-- Status Bar -->
    <footer class="h-6 border-t border-cyan-900/50 bg-slate-950 flex items-center justify-between px-3 text-[9px] text-cyan-950 font-mono uppercase tracking-[0.2em] relative z-20">
        <div class="flex items-center gap-5">
            <div class="flex items-center gap-1.5"><i class="fa-solid fa-microchip text-cyan-900"></i> Local Bridge</div>
            <div class="flex items-center gap-1.5"><i class="fa-solid fa-circle text-cyan-500 text-[4px] animate-glow"></i> Optimized</div>
        </div>
        <div class="flex items-center gap-5">
            <div id="quotaStatus" class="flex items-center gap-1.5 overflow-hidden">
                <i class="fa-solid fa-battery-half"></i>
                <span id="quotaPercent">0%</span>
            </div>
            <div id="cursorPos">C:[<span id="cursorLine">1</span>:<span id="cursorCol">1</span>]</div>
            <div class="opacity-30">ENC:NEON-8</div>
        </div>
    </footer>
</body></html>`;


export const UI_JS = `
// Safe definition of backtick to avoid template literal collisions
const BACKTICK = String.fromCharCode(96);
const DOLLAR = "$";
console.log("UI_VERSION_HOLD_FIX_V27.6 Loaded - Deployment Stability Patch Active");

let explorerMode = 'list';
let chatHistory = [];
let activeFile = null;
let openTabs = [];
let fileTree = [];
let activeImage = null;
let editor = null;
let currentCode = '';
let diffEditor = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let autoAudio = false;

// Helper: Escape string for JS inclusion
function escapeJsString(str) {
    if (!str) return '';
    return str.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'").replace(/"/g, '\\\\"').replace(/\\\\n/g, '\\\\n').replace(/\\\\r/g, '\\\\r');
}

window.escapeHtml = function(text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

// Deployment logic
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
            const apiBase = (typeof window.getApiBase === "function") ? window.getApiBase() : "";
            const res = await fetch(apiBase + '/api/fs/file?name=' + encodeURIComponent('src/index.ts'));
            if(res.ok) {
                const d = await res.json();
                codeToDeploy = d.content;
            }
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
            alert("🚀 Success! Deployed to namespace " + result.result.namespace + "\\nScript: " + result.result.script);
        } else {
             alert('Deployment Failed: ' + (result.error || 'Unknown Error'));
        }
    } catch (e) {
        alert('Deployment Error: ' + e.message);
    } finally {
        btn.innerHTML = originalText;
        if (btn instanceof HTMLButtonElement) btn.disabled = false;
    }
};

// --- Monaco Setup ---
if (window.require || typeof require !== 'undefined') {
    const loader = window.require || require;
    loader.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});
    loader(['vs/editor/editor.main'], function(monacoInstance) {
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
            const ln = document.getElementById('cursorLine');
            const cl = document.getElementById('cursorCol');
            if (ln) ln.innerText = e.position.lineNumber;
            if (cl) cl.innerText = e.position.column;
        });

        // Ctrl+S to save
        editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
            if (activeFile) window.saveCurrentFile(activeFile, editor.getValue());
        });

        window.refreshFiles();
    });
} else {
    console.error('Monaco loader not found');
}

// Terminal
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
            const apiBase = (typeof window.getApiBase === "function") ? window.getApiBase() : "";
            const res = await fetch(apiBase + '/api/terminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd })
            });
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

// GitHub
window.toggleGithubSettings = function() {
    const current = localStorage.getItem('gh_token') || '';
    const token = prompt("Enter GitHub PAT:", current);
    if (token !== null) localStorage.setItem('gh_token', token);
};

window.ghClone = async function() {
    const repoInput = document.getElementById('ghRepo');
    const repoRaw = repoInput?.value;
    const token = localStorage.getItem('gh_token');
    if (!repoRaw || !token) return alert("Missing Repo (owner/repo) or Token (set in gear icon)");

    const btn = document.querySelector('button[onclick="window.ghClone()"]');
    const oldText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';

    try {
        const parts = repoRaw.split('/');
        const owner = parts[0];
        const repo = parts[1];

        // 1. Get file list
        const listRes = await fetch('/api/github/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, owner, repo })
        });
        const listData = await listRes.json();
        if (listData.error) throw new Error(listData.error);

        const files = listData.files || [];
        const apiBase = (typeof window.getApiBase === "function") ? window.getApiBase() : "";

        // 2. Fetch and save each file
        for (const file of files) {
            const contentRes = await fetch('/api/github/content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, owner, repo, path: file.path })
            });
            const contentData = await contentRes.json();

            // Save to R2 or Local Bridge
            await fetch(apiBase + '/api/fs/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: file.path,
                    content: contentData.content,
                    encoding: contentData.encoding // Handles base64 from GH
                })
            });
        }

        alert('Successfully synced ' + files.length + ' files!');
        window.refreshFiles();
    } catch (e) {
        alert("Clone Failed: " + e.message);
    } finally { btn.innerHTML = oldText; }
};

// Files
window.refreshFiles = async function() {
    const listEl = document.getElementById('fileList');
    if (listEl) listEl.innerHTML = '<div class="text-slate-500 text-xs p-2">Loading...</div>';
    try {
        const res = await fetch('/api/fs/list');
        const files = await res.json();
        fileTree = files;
        window.renderFileList(files);
        if (!activeFile && files.length > 0) {
            const indexFile = files.find(f => f.name === 'src/index.ts') || files[0];
            window.loadFile(indexFile.name);
        }
    } catch (e) { if (listEl) listEl.innerHTML = '<div class="text-red-400 text-xs p-2">Failed</div>'; }
};

window.renderFileList = function(files) {
    const listEl = document.getElementById('fileList');
    const galleryEl = document.getElementById('galleryList');
    const bibleEl = document.getElementById('biblePanel');
    const audioEl = document.getElementById('audioStudioPanel');
    if (!listEl || !galleryEl || !bibleEl || !audioEl) return;

    if (explorerMode === 'gallery') {
        listEl.classList.add('hidden');
        galleryEl.classList.remove('hidden');
        bibleEl.classList.add('hidden');
        audioEl.classList.add('hidden');
        window.renderAssetGallery(files);
        return;
    } else if (explorerMode === 'bible') {
        listEl.classList.add('hidden');
        galleryEl.classList.add('hidden');
        bibleEl.classList.remove('hidden');
        audioEl.classList.add('hidden');
        return;
    } else if (explorerMode === 'audio') {
        listEl.classList.add('hidden');
        galleryEl.classList.add('hidden');
        bibleEl.classList.add('hidden');
        audioEl.classList.remove('hidden');
        return;
    } else {
        listEl.classList.remove('hidden');
        galleryEl.classList.add('hidden');
        bibleEl.classList.add('hidden');
        audioEl.classList.add('hidden');
    }

    listEl.innerHTML = '';
    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'group flex items-center justify-between px-3 py-1.5 text-slate-300 hover:bg-slate-700/50 cursor-pointer rounded-md';
        const safeName = escapeJsString(file.name);
        div.innerHTML = '<div class="flex items-center gap-2 truncate flex-1" onclick="window.loadFile(\\'' + safeName + '\\')">' +
                        '<i class="fa-regular fa-file-code text-slate-500 group-hover:text-indigo-400"></i>' +
                        '<span>' + file.name + '</span>' +
                        '</div>' +
                        '<button class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400" onclick="event.stopPropagation(); window.deleteFile(\\'' + safeName + '\\')"><i class="fa-solid fa-trash text-xs"></i></button>';
        listEl.appendChild(div);
    });
};

window.toggleExplorerMode = function() {
    explorerMode = (explorerMode === 'list') ? 'gallery' : 'list';
    const btn = document.getElementById('explorerToggle');
    if (btn) btn.innerHTML = explorerMode === 'list' ? '<i class="fa-solid fa-table-cells text-sm"></i>' : '<i class="fa-solid fa-list text-sm"></i>';
    if (explorerMode !== 'list' && explorerMode !== 'gallery') explorerMode = 'list'; // Reset from bible
    window.renderFileList(fileTree);
};

window.toggleAudioStudio = function() {
    const listEl = document.getElementById('fileList');
    const galleryEl = document.getElementById('galleryList');
    const bibleEl = document.getElementById('biblePanel');
    const audioEl = document.getElementById('audioStudioPanel');
    const btn = document.getElementById('audioStudioToggle');

    if (explorerMode === 'audio') {
        explorerMode = 'list';
        audioEl.classList.add('hidden');
        listEl.classList.remove('hidden');
        btn.classList.replace('text-indigo-400', 'text-slate-500');
    } else {
        explorerMode = 'audio';
        audioEl.classList.remove('hidden');
        listEl.classList.add('hidden');
        galleryEl.classList.add('hidden');
        bibleEl.classList.add('hidden');

        // Reset button states
        const bibleBtn = document.getElementById('bibleToggle');
        if (bibleBtn) bibleBtn.classList.replace('text-indigo-400', 'text-slate-500');
        btn.classList.replace('text-slate-500', 'text-indigo-400');
    }
};

window.generateAudio = async function() {
    const text = document.getElementById('audioInput').value;
    const model = document.getElementById('audioModel').value;
    const btn = document.getElementById('generateAudioBtn');
    if (!text) return alert("Enter dialogue first.");

    const oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

    try {
        const res = await fetch('/api/audio/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, model })
        });
        if (!res.ok) throw new Error(await res.text());

        const blob = await res.blob();
        window.lastGeneratedAudioBlob = blob;
        const url = URL.createObjectURL(blob);

        const preview = document.getElementById('audioPreview');
        const player = document.getElementById('previewPlayer');
        preview.classList.remove('hidden');
        player.src = url;
        player.play();

        // Suggest a name
        const suggestedName = text.substring(0, 10).replace(/\\s+/g, '_').toLowerCase() + "_" + Date.now() + ".mp3";
        document.getElementById('audioName').value = suggestedName;

    } catch (e) {
        alert("Audio Gen Failed: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = oldText;
    }
};

window.saveGeneratedAudio = async function() {
    const name = document.getElementById('audioName').value;
    const blob = window.lastGeneratedAudioBlob;
    if (!name || !blob) return alert("Nothing to save.");

    try {
        const reader = new FileReader();
        reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            const apiBase = (typeof window.getApiBase === "function") ? window.getApiBase() : "";
            const res = await fetch(apiBase + '/api/fs/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'audio/' + name, content: base64, encoding: 'base64' })
            });
            if (res.ok) {
                alert("Saved to audio/" + name);
                window.refreshFiles();
            } else {
                throw new Error(await res.text());
            }
        };
        reader.readAsDataURL(blob);
    } catch (e) {
        alert("Save Failed: " + e.message);
    }
};

window.toggleBible = function() {
    const listEl = document.getElementById('fileList');
    const galleryEl = document.getElementById('galleryList');
    const bibleEl = document.getElementById('biblePanel');
    const btn = document.getElementById('bibleToggle');

    if (explorerMode === 'bible') {
        explorerMode = 'list';
        bibleEl.classList.add('hidden');
        listEl.classList.remove('hidden');
        btn.classList.replace('text-indigo-400', 'text-slate-500');
    } else {
        explorerMode = 'bible';
        bibleEl.classList.remove('hidden');
        listEl.classList.add('hidden');
        galleryEl.classList.add('hidden');
        btn.classList.replace('text-slate-500', 'text-indigo-400');
        window.loadBible();
    }
};

window.showBibleTab = function(tab) {
    const lore = document.getElementById('loreWiki');
    const tasks = document.getElementById('kanbanBoard');
    if (tab === 'lore') {
        lore.classList.remove('hidden');
        tasks.classList.add('hidden');
    } else {
        lore.classList.add('hidden');
        tasks.classList.remove('hidden');
        window.renderKanban();
    }
};

window.loadBible = async function() {
    try {
        const apiBase = (typeof window.getApiBase === "function") ? window.getApiBase() : "";
        const res = await fetch(apiBase + '/api/fs/file?name=BIBLE_LORE.md');
        if (res.ok) {
            const data = await res.json();
            document.getElementById('loreWiki').innerHTML = window.formatToken(data.content);
        }

        const tRes = await fetch(apiBase + '/api/fs/file?name=BIBLE_TASKS.json');
        if (tRes.ok) {
            const tData = await tRes.json();
            window.bibleTasks = JSON.parse(tData.content);
            window.renderKanban();
        }
    } catch(e){ console.error('Chat Error:', e); }
};
window.sendMessage = window.sendMessage; // Redundant but good for grep

window.renderKanban = function() {
    const tasks = window.bibleTasks || [];
    ['todo', 'doing', 'done'].forEach(status => {
        const list = document.getElementById(status + 'List');
        if (!list) return;
        list.innerHTML = '';
        tasks.filter(t => t.status === status).forEach(task => {
            const div = document.createElement('div');
            div.className = 'kanban-item';
            div.innerHTML = '<div class="font-bold mb-1">' + task.title + '</div>' +
                            '<div class="text-[9px] text-slate-500">' + (task.description || '') + '</div>';
            list.appendChild(div);
        });
    });
};

window.renderAssetGallery = function(files) {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // Filter for media files (Enhanced for Phase 3)
    const mediaFiles = files.filter(f => f.name.match(/\\.(png|jpg|jpeg|gif|webp|glb|gltf|mp3|wav|ogg)$/i));

    if (mediaFiles.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-10 text-slate-500 text-xs">No media assets found</div>';
        return;
    }

    mediaFiles.forEach(async file => {
        const card = document.createElement('div');
        card.className = 'asset-card group';
        const safeName = escapeJsString(file.name);
        card.onclick = () => window.loadFile(file.name);

        const is3D = file.name.match(/\\.(glb|gltf)$/i);
        const isAudio = file.name.match(/\\.(mp3|wav|ogg)$/i);
        const apiBase = (typeof window.getApiBase === "function") ? window.getApiBase() : "";

        card.innerHTML = '<div class="flex items-center justify-center h-full"><i class="fa-solid fa-spinner fa-spin text-slate-700"></i></div>' +
                         '<div class="asset-meta truncate">' + file.name + '</div>';
        grid.appendChild(card);

        // Lazy load thumbnail or icon
        try {
            const res = await fetch(apiBase + '/api/fs/file?name=' + encodeURIComponent(file.name));
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                if (is3D) {
                    card.innerHTML = '<model-viewer src="' + url + '" style="width:100%;height:100%" auto-rotate interaction-prompt="none"></model-viewer>' +
                                     '<div class="asset-meta truncate">' + file.name + '</div>';
                } else if (isAudio) {
                    card.innerHTML = '<div class="flex flex-col items-center justify-center h-full bg-slate-800/50">' +
                                     '<i class="fa-solid fa-file-audio text-3xl text-indigo-400 mb-1"></i>' +
                                     '<div class="text-[8px] text-slate-400">Audio Clip</div>' +
                                     '</div>' +
                                     '<div class="asset-meta truncate">' + file.name + '</div>';
                } else {
                    card.innerHTML = '<img src="' + url + '" class="asset-thumb" onload="window.URL.revokeObjectURL(this.src)">' +
                                     '<div class="asset-meta truncate">' + file.name + '</div>';
                }
            }
        } catch(e) {
            card.innerHTML = '<div class="flex items-center justify-center h-full text-red-900"><i class="fa-solid fa-image"></i></div>';
        }
    });
};

window.deleteFile = async function(name) {
    if (!confirm('Delete ' + name + '?')) return;
    try {
        await fetch('/api/fs/file', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        window.refreshFiles();
    } catch(e) { alert('Failed'); }
};

window.loadFile = async function(name) {
    activeFile = name;
    const previewContainer = document.getElementById('previewContainer');
    const isMedia = name.match(/\\.(png|jpg|jpeg|gif|webp|glb|gltf)$/i);

    if (isMedia) {
        previewContainer.style.display = 'block';
        previewContainer.innerHTML = '<div class="flex items-center justify-center h-full text-slate-500 font-mono text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading Media...</div>';
        try {
            const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
            if (!res.ok) throw new Error('Failed to load media');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);

            if (name.match(/\\.(glb|gltf)$/i)) {
                previewContainer.innerHTML = '<model-viewer src="' + url + '" camera-controls auto-rotate style="width:100%;height:100%"></model-viewer>';
            } else {
                previewContainer.innerHTML = '<div class="flex items-center justify-center h-full bg-slate-900/50 backdrop-blur-sm p-4">' +
                    '<img src="' + url + '" class="max-w-full max-h-full shadow-2xl rounded-lg border border-white/10" onload="window.URL.revokeObjectURL(this.src)">' +
                    '</div>';
            }
        } catch (e) {
            previewContainer.innerHTML = '<div class="flex flex-col items-center justify-center h-full text-red-400 gap-2">' +
                '<i class="fa-solid fa-circle-exclamation text-2xl"></i>' +
                '<span class="text-xs font-mono">' + e.message + '</span>' +
                '</div>';
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
    if (activeFile && !openTabs.includes(activeFile)) openTabs.push(activeFile);
    const container = document.getElementById('tabsContainer');
    if (!container) return;
    container.innerHTML = '';
    openTabs.forEach(t => {
        const div = document.createElement('div');
        const isActive = (t === activeFile);
        div.className = 'px-3 py-2 text-xs flex items-center gap-2 cursor-pointer ' + (isActive ? 'bg-slate-800 border-t-2 border-indigo-500 text-slate-200' : 'bg-slate-900/50 text-slate-500');
        div.onclick = () => window.loadFile(t);
        const safeTab = escapeJsString(t);
        div.innerHTML = '<span>' + t + '</span><i class="fa-solid fa-times hover:text-red-400" onclick="event.stopPropagation(); window.closeTab(\\'' + safeTab + '\\')"></i>';
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
    if (editor && !name.match(/\\.(png|jpg|jpeg|gif|webp|glb|gltf)$/i)) content = editor.getValue();
    await fetch('/api/fs/file', { method: 'POST', body: JSON.stringify({ name, content }) });
};

// Event Listeners for UI
const initUI = () => {
    const chatInput = document.getElementById('chatInput');
    const chatBtn = document.getElementById('chatSendButton');
    if (chatBtn) chatBtn.onclick = () => window.sendMessage();
    if (chatInput) {
        chatInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                window.sendMessage();
            }
        };
    }
    console.log('✅ UI Event Handlers Initialized');
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
} else {
    initUI();
}

// AI assistant
window.sendMessage = async function() {
    const input = document.getElementById('chatInput');
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';
    window.addMessage('user', text);
    const aiDiv = window.addMessage('ai', '', true);

    try {
        const model = document.getElementById('modelSelector')?.value;
        const isImageModel = model === 'flux' || model === 'sdxl';
        const endpoint = isImageModel ? '/api/image' : '/api/chat';

        // Add to history
        chatHistory.push({ role: 'user', content: text });

        const res = await fetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({
                message: text,
                history: chatHistory.slice(-10), // Send last 10 messages for context
                prompt: text,
                style: model === 'sdxl' ? 'realism' : 'speed',
                model,
                image: activeImage
            })
        });

        if (!res.ok) throw new Error('Status ' + res.status);

        if (endpoint === '/api/image') {
            const data = await res.json();
            aiDiv.innerHTML = '<div class="flex flex-col gap-2">' +
                '<img src="' + data.image + '" class="rounded-lg shadow-xl cursor-pointer" onclick="window.loadFile(\\'' + data.filename + '\\')">' +
                '<span class="text-[10px] text-slate-500 italic">Saved as ' + data.filename + '</span>' +
                '</div>';
            window.refreshFiles();
            return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        aiDiv.innerHTML = '';
        let fullText = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            // DEBUG: console.log('Chunk received:', chunk);
            const lines = chunk.split('\\n\\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(trimmed.slice(6));
                        if (data.token) {
                            fullText += data.token;
                            aiDiv.innerHTML = window.formatToken(fullText);
                        }
                    } catch(e){
                         console.warn('SSE Parse Error:', e, trimmed);
                    }
                }
            }
        }

        // Add to history and check for triggers
        chatHistory.push({ role: 'assistant', content: fullText });

        // Omni-Aware: Auto Image Trigger
        // Omni-Aware Art Triggers
        const imageMatch = fullText.match(/\\[IMAGE:\\s*(.*?)\\]/i);
        if (imageMatch && imageMatch[1]) {
            const prompt = imageMatch[1];
            window.addMessage('ai', '🎨 *Generating image: "' + prompt + '"*...', true);
            const imgRes = await fetch('/api/image', {
                method: 'POST',
                body: JSON.stringify({ prompt, style: 'speed' })
            });
            if (imgRes.ok) {
                const imgData = await imgRes.json();
                window.addMessage('ai', '<img src="' + imgData.image + '" class="rounded-lg cursor-pointer" onclick="window.loadFile(\\'' + imgData.filename + '\\')">');
                window.refreshFiles();
            }
        }

        // Detect GitHub Push Automation (Final Product Delivery)
        const githubMatch = fullText.match(/\\[GITHUB: push (.*?):(.*?):(.*?)\\]/i);
        if (githubMatch) {
            const [_, repoPath, branch, message] = githubMatch;
            const [owner, repo] = repoPath.split('/');
            const token = localStorage.getItem('gh_token');
            if (token && owner && repo) {
                window.addMessage('ai', '🚀 *Delivery in Progress: Pushing to GitHub (' + repoPath + ')...*', true);
                fetch('/api/github/push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, owner, repo, branch, message })
                }).then(r => r.json()).then(gData => {
                    if (gData.success) {
                        window.addMessage('ai', '✅ *Push Successful!* \\\\nFinal product delivered to ' + BACKTICK + repoPath + BACKTICK + ' on branch ' + BACKTICK + branch + BACKTICK + '. \\\\nSHA: ' + BACKTICK + gData.sha + BACKTICK);
                    } else {
                        window.addMessage('ai', '❌ *Push Failed:* ' + (gData.error || 'Unknown error'));
                    }
                }).catch(err => {
                    window.addMessage('ai', '❌ *GitHub Error:* ' + err.message);
                });
            } else {
                window.addMessage('ai', '⚠️ *GitHub Push Blocked:* Missing credentials or repo details. Please log in to GitHub in Settings.');
            }
        }

        // Detect Terminal Automation (Autonomous Terminal)
        const termMatch = fullText.match(/\\[TERM: (.*?)\\]/);
        if (termMatch && termMatch[1] && window.getApiBase()) {
            const command = termMatch[1];
            window.addMessage('ai', '💻 *Running Terminal Command: "' + command + '"*...', true);
            fetch(window.getApiBase() + '/api/terminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command })
            }).then(r => r.json()).then(tData => {
                const output = tData.output || 'Command executed';
                window.addMessage('ai', '🏁 *Terminal Result:* \\\\n' + BACKTICK + BACKTICK + BACKTICK + '\\\\n' + output.slice(-1000) + '\\\\n' + BACKTICK + BACKTICK + BACKTICK);
                window.refreshFiles();
            }).catch(err => {
                window.addMessage('ai', '❌ *Terminal Error:* \\\\n' + BACKTICK + err.message + BACKTICK);
            });
        }

        // Detect Blender Automation
        const blenderMatch = fullText.match(/\\[BLENDER: ([\\s\\S]*?)\\]/);
        if (blenderMatch && window.getApiBase()) {
            const script = blenderMatch[1];
            window.addMessage('ai', '🎬 *Running Blender Automation...*', true);
            fetch(window.getApiBase() + '/api/blender/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ script })
            }).then(r => r.json()).then(bData => {
                if (bData.success) {
                    const output = bData.output ? bData.output.slice(-500) : 'Done';
                    window.addMessage('ai', '✅ *Blender Task Complete!* \\\\n' + BACKTICK + BACKTICK + BACKTICK + '\\\\n' + output + '\\\\n' + BACKTICK + BACKTICK + BACKTICK);
                    window.refreshFiles();
                } else {
                    const errText = bData.error || 'Unknown error';
                    window.addMessage('ai', '❌ *Blender Error:* \\\\n' + BACKTICK + errText + BACKTICK);
                }
            }).catch(err => {
                window.addMessage('ai', '❌ *Bridge Error:* \\\\n' + BACKTICK + err.message + BACKTICK);
            });
        }

        // Detect Search Automation
        const searchMatch = fullText.match(/\\\[SEARCH: (.*?)\\\]/);
        if (searchMatch && searchMatch[1]) {
            const pattern = searchMatch[1];
            window.addMessage('ai', '🔍 *Searching project for: "' + pattern + '"*...', true);

            // OPTIMIZATION: Prioritize Local Bridge Search
            const localApi = (typeof localBridgeAvailable !== 'undefined' && localBridgeAvailable) ? 'http://127.0.0.1:3030' : '';
            const apiBase = localApi || ((typeof window.getApiBase === "function") ? window.getApiBase() : "");

            fetch(apiBase + '/api/fs/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pattern })
            }).then(r => r.json()).then(sData => {
                if (sData.results && sData.results.length > 0) {
                    let resHtml = '✅ *Search Results for "' + pattern + '":*\\\\n';
                    sData.results.slice(0, 10).forEach(r => {
                        resHtml += '• [' + r.file + '](file://' + r.file + ') (Line ' + r.line + '): ' + BACKTICK + r.content + BACKTICK + '\\\\n';
                    });
                    if (sData.results.length > 10) resHtml += '*...and ' + (sData.results.length - 10) + ' more results.*';
                    window.addMessage('ai', resHtml);
                } else {
                    window.addMessage('ai', 'ℹ️ *No results found for "' + pattern + '".*');
                }
            }).catch(err => {
                window.addMessage('ai', '❌ *Search Error:* ' + err.message);
            });
        }

        // Detect Read File Automation
        const readMatch = fullText.match(/\\\[READ: (.*?)\\\]/);
        if (readMatch && readMatch[1]) {
            const path = readMatch[1];
            window.addMessage('ai', '📖 *Reading file: "' + path + '"*...', true);
            const apiBase = (typeof window.getApiBase === "function") ? window.getApiBase() : "";
            fetch(apiBase + '/api/fs/file?name=' + encodeURIComponent(path))
                .then(r => r.json())
                .then(fData => {
                    if (fData.content) {
                        window.addMessage('ai', '📄 *Content of ' + path + ':*\\\\n' + window.formatToken(BACKTICK + BACKTICK + BACKTICK + '\\\\n// file: ' + path + '\\\\n' + fData.content + '\\\\n' + BACKTICK + BACKTICK + BACKTICK));
                    } else {
                        window.addMessage('ai', '❌ *Could not read ' + path + '*');
                    }
                }).catch(err => {
                    window.addMessage('ai', '❌ *Read Error:* ' + err.message);
                });
        }

        // Optimized Project Init: Dynamic Scaffolding
        const initMatch = fullText.match(/\\\[PROJECT-INIT: (.*?)\\\]/);
        if (initMatch && initMatch[1]) {
            const prompt = initMatch[1];
            window.addMessage('ai', '🏗️ *Initializing Dynamic Scaffolding: ' + prompt + '*...', true);
            window.addMessage('ai', 'ℹ️ *I am designing the structure system-wide. Please wait...*');
            // AI will now follow up with multiple code blocks to build this manually
        }

        if (autoAudio) window.speakResponse(fullText);
    } catch(e) { aiDiv.innerText = 'Error: ' + e.message; }
};

// --- Audio / Voice Logic ---
window.toggleAutoAudio = function() {
    autoAudio = !autoAudio;
    const btn = document.getElementById('audioToggle');
    btn.className = 'p-1.5 rounded-full transition ' + (autoAudio ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400');
};

window.speakResponse = async function(text) {
        // Strip all code blocks, backticks, bold/italic, and URLs for clean speech
        // Strip all code blocks, backticks, bold/italic, and URLs for clean speech
        const cleanText = text
            .replace(new RegExp(BACKTICK.repeat(3) + '[\\\\s\\\\S]*?' + BACKTICK.repeat(3), 'g'), ' [code block] ')
            .replace(new RegExp(BACKTICK + '[\\\\s\\\\S]*?' + BACKTICK, 'g'), '')
            .replace(/[*_#~]/g, '')
            .replace(/\\[.*?\\]\\(.*?\\)/g, '')
            .replace(/https?:\\/\\/\\S+/g, '')
            .trim()
            .substring(0, 1000);

        if (!cleanText || cleanText === '[code block]') return;

        const res = await fetch('/api/audio/tts', {
            method: 'POST',
            body: JSON.stringify({ text: cleanText, model: 'aura' })
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
    } catch(e) { console.error('TTS Failed', e); }
};

window.toggleVoice = async function() {
    if (isRecording) {
        window.stopSpeechToText();
    } else {
        window.startSpeechToText();
    }
};

window.startSpeechToText = async function() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => audioChunks.push(event.data);
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const status = document.getElementById('voiceStatus');
            status.innerText = 'Transcribing...';

            try {
                const res = await fetch('/api/audio/stt', {
                    method: 'POST',
                    body: audioBlob
                });
                if (!res.ok) {
                    const err = await res.text();
                    throw new Error(err);
                }
                const data = await res.json();
                if (data.text) {
                    const input = document.getElementById('chatInput');
                    input.value = '[VOICE_COMMAND] ' + data.text;
                    // Auto-send on release for game-dev speed
                    window.sendMessage();
                }
            } catch(e) { console.error('STT Failed', e); }
            status.classList.add('hidden');
        };

        mediaRecorder.start();
        isRecording = true;
        document.getElementById('voiceBtn').className = 'p-1.5 rounded-full bg-cyan-600 text-white animate-pulse transition shadow-[0_0_15px_rgba(34,211,238,0.5)]';
        document.getElementById('voiceStatus').classList.remove('hidden');
        document.getElementById('voiceStatus').innerText = 'Intercepting Audio...';
    } catch (e) { alert('Microphone access denied or not supported'); }
};

window.stopSpeechToText = function() {
    if (mediaRecorder) mediaRecorder.stop();
    isRecording = false;
    document.getElementById('voiceBtn').className = 'p-1.5 rounded-full bg-slate-900 text-slate-500 border border-transparent hover:border-cyan-500/30 transition shadow-sm';
};

window.addMessage = function(role, text, loading) {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    const isUser = (role === 'user');
    div.className = 'p-3 rounded-lg border ' + (isUser ? 'bg-slate-900/80 ml-6 border-cyan-900/30 text-cyan-100/90' : 'bg-cyan-950/10 mr-6 border-cyan-500/20 text-cyan-50 shadow-[inset_0_0_20px_rgba(34,211,238,0.02)]');

    if (loading) {
        div.innerHTML = '<div class="flex items-center gap-2"><i class="fa-solid fa-spinner fa-spin text-cyan-400 glow-text"></i> Processing Input...</div>';
    } else {
        div.innerHTML = window.formatToken(text);
    }

    container?.appendChild(div);
    if (container) container.scrollTop = container.scrollHeight;
    return div;
};

window.formatToken = function(text) {
    if (!text) return '';
    // Use the BACKTICK variable to avoid literal backticks in the worker string
    const pattern = new RegExp(BACKTICK + BACKTICK + BACKTICK + '(\\\\w+)?\\\\n(?:\\\\/\\\\/\\\\s*file:\\\\s*([^\\\\n\\\\r]+)\\\\n)?([\\\\s\\\\S]*?)' + BACKTICK + BACKTICK + BACKTICK, 'g');
    return text.replace(pattern, (m, lang, file, code) => {
        const encoded = encodeURIComponent(code);
        const safeFile = file ? encodeURIComponent(file) : '';
        return '<div class="bg-black/40 rounded p-2 my-2 border border-slate-700 relative group">' +
            '<div class="flex justify-between text-[10px] text-slate-500 mb-1 uppercase">' +
                '<span>' + (file || lang || 'code') + '</span>' +
                '<button onclick="window.applyCode(\\'' + encoded + '\\', \\'' + safeFile + '\\')" class="text-indigo-400 hover:text-indigo-300 opacity-0 group-hover:opacity-100 transition">Apply</button>' +
            '</div>' +
            '<pre class="text-xs overflow-x-auto">' + window.escapeHtml(code) + '</pre>' +
        '</div>';
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
        // @ts-ignore
        diffEditor = monaco.editor.createDiffEditor(document.getElementById('diffContainer'), { theme: 'vs-dark', automaticLayout: true });
    }
    diffEditor.setModel({
        // @ts-ignore
        original: monaco.editor.createModel(editor.getValue(), 'typescript'),
        // @ts-ignore
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

// Deprecated: Moving to Dynamic AI-designed Scaffolding
window.handleProjectInit = async function(blueprint) {
    window.addMessage('ai', '⚠️ *Unified Scaffolding:* Please describe the project in chat, and I will build the files dynamically for you.');
};
window.getLanguage = (n) => {
    if (n.endsWith('.ts')) return 'typescript';
    if (n.endsWith('.js')) return 'javascript';
    if (n.endsWith('.html')) return 'html';
    if (n.endsWith('.css')) return 'css';
    if (n.endsWith('.json') || n.endsWith('.jsonc')) return 'json';
    if (n.endsWith('.md')) return 'markdown';
    if (n.endsWith('.py')) return 'python';
    return 'plaintext';
};

window.createNewFile = async function() {
    const name = prompt("Filename:");
    if (name) {
        const apiBase = (typeof window.getApiBase === "function") ? window.getApiBase() : "";
        await fetch(apiBase + '/api/fs/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content: '' })
        });
        window.refreshFiles();
    }
};

window.uploadFile = async function(input) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        // @ts-ignore
        const base64 = e.target.result.split(',')[1];
        const apiBase = (typeof window.getApiBase === "function") ? window.getApiBase() : "";
        await fetch(apiBase + '/api/fs/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, content: base64, encoding: 'base64' })
        });
        window.refreshFiles();
    };
    reader.readAsDataURL(file);
};

// Health & Quota Polling
async function updateHealthStatus() {
    try {
        const res = await fetch('/api/health');
        if (res.ok) {
            const data = await res.json();
            const quotaPercent = data.kvWriteQuota || 0;
            const quotaElem = document.getElementById('quotaPercent');
            if (quotaElem) {
                quotaElem.innerText = quotaPercent + '%';
                const quotaParent = document.getElementById('quotaStatus');
                if (quotaPercent > 90) {
                    quotaParent.className = 'flex items-center gap-2 text-red-500 font-bold animate-pulse';
                } else if (quotaPercent > 70) {
                    quotaParent.className = 'flex items-center gap-2 text-yellow-500';
                } else {
                    quotaParent.className = 'flex items-center gap-2 text-slate-500';
                }
            }
        }

        // Detailed binding audit (V15)
        const docRes = await fetch('/api/doctor');
        if (docRes.ok) {
            const report = await docRes.json();
            console.log("Binding Health Audit:", report.bindings);
            if (report.issues.length > 0) {
                console.warn("IDE Issues Detected:", report.issues);
            }
        }
    } catch (e) {}
}

async function fetchModels() {
    try {
        const res = await fetch('/api/models');
        if (res.ok) {
            const data = await res.json();
            const selector = document.getElementById('modelSelector');
            if (selector && data.groups) {
                selector.innerHTML = '';
                data.groups.forEach(group => {
                    const groupEl = document.createElement('optgroup');
                    groupEl.label = group.name;
                    groupEl.className = 'bg-slate-900 text-indigo-400 font-bold';
                    group.models.forEach(modelKey => {
                        const modelId = data.catalog[modelKey];
                        if (modelId) {
                            const opt = document.createElement('option');
                            opt.value = modelKey.toLowerCase();
                            opt.className = 'bg-slate-800 text-slate-200 font-normal';
                            opt.innerText = modelKey + " (" + (typeof modelId === 'string' ? modelId.split('/').pop() : modelId) + ")";
                            groupEl.appendChild(opt);
                        }
                    });
                    selector.appendChild(groupEl);
                });
            }
        }
    } catch (e) {
        console.error("Failed to fetch models", e);
    }
}

setInterval(updateHealthStatus, 60000);
document.addEventListener('DOMContentLoaded', () => {
    updateHealthStatus();
    fetchModels();
});

window.updateHealthStatus = updateHealthStatus;
`;
