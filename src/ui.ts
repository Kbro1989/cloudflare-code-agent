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
            <button onclick="window.deployProject()" class="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded text-sm transition-colors flex items-center space-x-2 shadow-lg shadow-indigo-500/20">
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
                <div class="px-3 py-2 bg-[#1e1e1e] border-t-2 border-indigo-500 text-slate-200 text-xs flex items-center space-x-2 min-w-fit">
                    <span id="activeFileName">src/index.ts</span>
                    <button class="hover:text-red-400" onclick="window.closeTab()"><i class="fa-solid fa-times"></i></button>
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