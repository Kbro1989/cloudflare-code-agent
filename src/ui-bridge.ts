// file: src/ui-bridge.ts
/**
 * Local Bridge Integration
 * Enables Web IDE to connect to local filesystem via localhost:3030
 */

export const BRIDGE_INTEGRATION = `
// Local Bridge State
let localBridgeAvailable = false;
const BRIDGE_URL = 'http://localhost:3030';

// Detect Local Bridge on page load
window.detectLocalBridge = async function() {
    try {
        const res = await fetch(BRIDGE_URL + '/health', { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'ok') {
                localBridgeAvailable = true;
                console.log('✅ Local Bridge Connected:', data.workspace);
                window.updateModeIndicator('local');
                return true;
            }
        }
    } catch (e) {
        localBridgeAvailable = false;
        console.log('☁️  Using Cloud Mode (R2)');
        window.updateModeIndicator('cloud');
    }
    return false;
};

window.updateModeIndicator = function(mode) {
    const indicator = document.getElementById('modeIndicator');
    if (!indicator) return;

    if (mode === 'local') {
        indicator.innerHTML = '<i class="fa-solid fa-laptop"></i> Local';
        indicator.className = 'text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    } else {
        indicator.innerHTML = '<i class="fa-solid fa-cloud"></i> Cloud';
        indicator.className = 'text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30';
    }
};

// Helper: Get API base URL
window.getApiBase = function() {
    return localBridgeAvailable ? BRIDGE_URL : '';
};

// Override refreshFiles to use bridge
const _originalRefreshFiles = window.refreshFiles;
window.refreshFiles = async function() {
    const listEl = document.getElementById('fileList');
    if (listEl) {
        listEl.innerHTML = '<div class="text-slate-500 text-xs p-2">Loading...</div>';
    }
    try {
        const apiBase = window.getApiBase();
        const res = await fetch(apiBase + '/api/fs/list');
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

// Override saveCurrentFile to use bridge
window.saveCurrentFile = async function(name, content) {
    if (editor && !name.match(/\\.(png|jpg|glb|gltf)$/i)) {
        const model = editor.getModel();
        content = model ? model.getValue() : content;
    }

    const apiBase = window.getApiBase();
    await fetch(apiBase + '/api/fs/file', {
        method: 'POST',
        body: JSON.stringify({ name, content })
    });
};

// Init on page load
window.addEventListener('load', async () => {
    await window.detectLocalBridge();
    // Refresh files after bridge detection
    if (window.refreshFiles) window.refreshFiles();
});
`;
