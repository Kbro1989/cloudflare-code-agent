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

            <!-- GitHub Section -->
            <div class="p-3 border-t border-slate-700/50 bg-slate-800/30">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-xs font-semibold text-slate-400">GITHUB SYNC</span>
                    <button class="text-slate-500 hover:text-white" onclick="window.toggleGithubSettings()"><i class="fa-solid fa-cog"></i></button>
                </div>
                <div id="githubControls" class="space-y-2">
                    <div class="flex gap-1">
                        <input id="ghRepo" placeholder="owner/repo" class="bg-slate-900 border border-slate-700 text-xs text-slate-300 px-2 py-1 rounded w-full">
                    </div>
                     <div class="flex gap-1">
                        <button onclick="window.ghClone()" class="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs py-1 rounded"><i class="fa-solid fa-download"></i> Clone</button>
                        <button onclick="window.ghPush()" class="flex-1 bg-indigo-900 hover:bg-indigo-800 text-indigo-300 text-xs py-1 rounded"><i class="fa-solid fa-upload"></i> Push</button>
                    </div>
                </div>
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
        </main>

        <!-- Right Panel (Terminal + Chat) -->
        <aside class="w-80 glass-panel border-l border-slate-700 flex flex-col shadow-xl z-10" id="chatPanel">
            <div class="p-3 border-b border-slate-700/50 bg-slate-800/50 flex justify-between items-center backdrop-blur-md">
                <span class="text-sm font-semibold flex items-center gap-2"><i class="fa-solid fa-robot text-indigo-400"></i> AI Assistant</span>
                <span id="providerBadge" class="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300">Llama 3.3</span>
            </div>

            <div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
                <div class="chat-message p-3 rounded-lg border bg-indigo-900/20 mr-6">
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
            <div class="p-3 border-t border-slate-700/50 bg-slate-800/30 backdrop-blur-md">
                <input type="file" id="visionInput" accept="image/*,.glb,.gltf" style="display:none;" onchange="window.uploadFile(this)">
                <div class="flex gap-2 items-end">
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

    <!-- Diff Modal (God Mode) -->
    <div id="diffModal" class="fixed inset-0 z-50 bg-black/80 hidden flex items-center justify-center backdrop-blur-sm">
        <div class="bg-[#1e1e1e] w-[90%] h-[90%] border border-slate-600 rounded-lg shadow-2xl flex flex-col overflow-hidden">
            <div class="h-10 bg-[#2d2d2d] flex items-center justify-between px-4 border-b border-slate-700">
                <span class="font-bold text-slate-300"><i class="fa-solid fa-code-compare text-indigo-400 mr-2"></i>Review Changes</span>
                <div class="space-x-2">
                    <button onclick="window.rejectDiff()" class="text-xs bg-red-900/50 hover:bg-red-900 text-red-200 px-3 py-1 rounded transition border border-red-700">Reject</button>
                    <button onclick="window.acceptDiff()" class="text-xs bg-emerald-900/50 hover:bg-emerald-900 text-emerald-200 px-3 py-1 rounded transition border border-emerald-700">Accept</button>
                </div>
            </div>
            <div id="diffContainer" class="flex-1 relative"></div>
        </div>
    </div>

    <!-- Scripts -->
    <script type="module" src="/ui.js"></script>
</body>
</html>`;

export const UI_JS = `
function escapeJsString(str) {
    if (!str) return str;
    return String(str).replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "\\\\'");
}
`;
