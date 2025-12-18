export const UI_JS = `// Helper function to escape strings for JavaScript literal insertion
function escapeJsString(str) {
    // Escapes single quotes and backslashes for insertion into a JavaScript string literal within HTML attributes.
    // Note: The '$' character does not need special escaping when injecting into a plain JS string literal.
    return str.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, '\\\'');
}

// Global variables for the IDE state
let editor; // Monaco editor instance
let activeFile = 'loading...'; // Currently active file name
let currentCode = ''; // Content of the currently active file
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
            alert('Success! Deployed to namespace \'' + escapeJsString(result.result.namespace) + '\'.\nScript: ' + escapeJsString(result.result.script));
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
constMONACO_VS_URL = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs';
require.config({ paths: { vs: MONACO_VS_URL } });
window.MonacoEnvironment = { getWorkerUrl: () => proxy };

let proxy = URL.createObjectURL(
  new Blob(
    [
      `
  self.MonacoEnvironment = {
    baseUrl: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/'
  };
  importScripts('https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/base/worker/workerMain.js');
`
    ],
    { type: 'text/javascript' }
  )
);

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
    window.setupResizablePanels();
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
        const isActive = file.name === activeFile;
        
        let iconClass = 'fa-regular fa-file-code';
        if (file.name.endsWith('.js')) iconClass = 'fa-brands fa-js-square text-yellow-400';
        if (file.name.endsWith('.json')) iconClass = 'fa-regular fa-file-alt text-orange-400';
        if (file.name.match(new RegExp('\\.(png|jpg|jpeg|gif)$', 'i'))) iconClass = 'fa-regular fa-file-image text-cyan-400';
        if (file.name.match(new RegExp('\\.(glb|gltf)$', 'i'))) iconClass = 'fa-solid fa-cube text-indigo-400';

        div.className = "group flex items-center justify-between px-3 py-1.5 text-slate-300 hover:bg-slate-700/50 cursor-pointer rounded-md transition-colors " + (isActive ? 'bg-slate-700' : '');
        
        div.innerHTML = 
            '<div class="flex items-center gap-2 truncate" onclick="window.loadFile(\'' + escapeJsString(file.name) + '\')">' +
                '<i class="' + iconClass + ' text-slate-500 group-hover:text-indigo-400 transition-colors text-xs"></i>' +
                '<span>' + file.name + '</span>' +
            '</div>' +
            '<button onclick="event.stopPropagation(); window.deleteFile(\'' + escapeJsString(file.name) + '\')" class="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">' +
                '<i class="fa-solid fa-trash-alt"></i>' +
            '</button>';
        listEl.appendChild(div);
    });
};

window.loadFile = async function(name) {
    activeFile = name;
    window.renderFileList(fileTree); // Re-render to show active file
    const activeFileNameElement = document.getElementById('activeFileName');
    if (activeFileNameElement) {
        activeFileNameElement.innerText = name;
    }
    const container = document.getElementById('editorContainer');
    if (!container) return;

    // 3D Preview
    if (name.match(new RegExp('\\.(glb|gltf)$', 'i'))) {
         activeImage = null;
         const res = await fetch('/api/fs/File?name=' + encodeURIComponent(name));
         const blob = await res.blob();
         const url = URL.createObjectURL(blob);

         container.innerHTML = '<div class="h-full w-full bg-slate-900 relative">' +
        '<model-viewer\nsrc="' + url + '"\nid="mv-viewer"\ncamera-controls\nauto-rotate\nshadow-intensity="1"\nstyle="width: 100%; height: 100%;"\nalt="A 3D model"\nbackground-color="#1e23b"\n    ></model-viewer>\n    <div class="absolute bottom-5 left-0 right-0 text-center pointer-events-none">' +
        '<span class="bg-black/50 text-white px-2 py-1 rounded text-xs">3D Preview: ' + name + '</span>' +
            '</div>' +
            '</div>';
         return;
    }

    // Image Preview
    if (name.match(new RegExp('\\.(png|jpg)$', 'i'))) {
         activeImage = name;
         const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
         const data = await res.json();
         let src = data.content;
         if (!src.startsWith('data:') && !src.startsWith('http')) {
             src = 'data:image/png;base64,' + data.content;
         }

         container.innerHTML = "<div class=\"h-full flex items-center justify-center bg-slate-900\">\n                        <img src=\"" + src + "\" class=\"max-w-[90%] max-h-[90%] shadow-lg border border-slate-700 rounded\">\n                    </div>";
         return;
    }

    // Code/Text
    if (!container.querySelector('.monaco-editor')) {
        // This is a soft-reload. Re-initializes editor if not present
        editor = window.monaco.editor.create(container, {
            value: '', language: 'typescript', theme: 'vs-dark', automaticLayout: true
        });
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

window.deleteFile = async function(name) {
    if (confirm("Are you sure you want to delete " + name + "?")) {
        await fetch('/api/fs/file', {
            method: 'DELETE',
            body: JSON.stringify({ name })
        });
        if (activeFile === name) {
            activeFile = null;
            document.getElementById('editorContainer').innerHTML = '<div class="p-4 text-slate-500">Select a file</div>';
            document.getElementById('activeFileName').innerText = 'No file selected';
        }
        window.refreshFiles();
    }
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
aiDiv.innerHTML = "<div class=\\"flex flex-col gap-2\\">\\n                <img src=\\"" + data.image + "\\" class=\\"rounded border border-slate-600\\" id=\\"" + id + "\\">\\n                <button onclick=\\"window.saveImage('" + id + "', '" + escapeJsString(prompt) + "')\\" class=\\"bg-indigo-600 text-xs py-1 px-2 text-white rounded self-end\\">Save</button>\\n            </div>";
    } catch(e) {
        aiDiv.innerText = 'Generation Failed: ' + escapeJsString(e.message);
    }
};

window.saveImage = async function(id, prompt) {
    const img = document.getElementById(id);
    if (!img) return;
    const base64 = img.src.split(',')[1];
    const name = "assets/" + prompt.substring(0,10).replace(/\\s/g, '_') + "_" + Date.now() + ".png";
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
div.className = "chat-message p-3 rounded-lg border " + (role === 'user' ? 'bg-slate-700/50 ml-6' : 'bg-indigo-900/20 mr-6');
    if(loading) div.innerHTML = 'Thinking...';
    else div.innerHTML = window.formatToken(text);
    if (chatMessages) {
        chatMessages.appendChild(div);
    }
    return div;
};

window.formatToken = function(t) { return t.replace(/\\n/g, '<br>'); };

window.getLanguage = function(n) {
    if(n.endsWith('ts')) return 'typescript';
    if(n.endsWith('js')) return 'javascript';
    if(n.endsWith('json')) return 'json';
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
                aiDiv.innerHTML = "✅ Uploaded <b>" + escapeJsString(file.name) + "</b>. <br><span class=\\"text-xs opacity-50\\">Stored in R2. Ready for Vision.</span>";
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

window.setupResizablePanels = function() {
    const sidebar = document.getElementById('sidebar');
    const chatPanel = document.getElementById('chatPanel');
    const resizerSidebar = document.getElementById('resizer-sidebar');
    const resizerChat = document.getElementById('resizer-chat');

    // Load saved widths
    const savedSidebarWidth = localStorage.getItem('sidebarWidth');
    const savedChatWidth = localStorage.getItem('chatPanelWidth');
    if (savedSidebarWidth) sidebar.style.width = savedSidebarWidth;
    if (savedChatWidth) chatPanel.style.width = savedChatWidth;

    let isResizingSidebar = false;
    resizerSidebar.addEventListener('mousedown', (e) => {
        isResizingSidebar = true;
        document.body.style.cursor = 'col-resize';
    });

    let isResizingChat = false;
    resizerChat.addEventListener('mousedown', (e) => {
        isResizingChat = true;
        document.body.style.cursor = 'col-resize';
    });

    window.addEventListener('mousemove', (e) => {
        if (isResizingSidebar) {
            const newWidth = e.clientX;
            if (newWidth > 150 && newWidth < 500) { // Min/max width
                sidebar.style.width = newWidth + 'px';
            }
        }
        if (isResizingChat) {
            const newWidth = window.innerWidth - e.clientX;
            if (newWidth > 200 && newWidth < 600) { // Min/max width
                chatPanel.style.width = newWidth + 'px';
            }
        }
    });

    window.addEventListener('mouseup', () => {
        isResizingSidebar = false;
        isResizingChat = false;
        document.body.style.cursor = 'default';
        
        // Save final widths
        localStorage.setItem('sidebarWidth', sidebar.style.width);
        localStorage.setItem('chatPanelWidth', chatPanel.style.width);
    });
};
`;
