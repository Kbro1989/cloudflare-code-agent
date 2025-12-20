// file: src/ui-bridge.ts
/**
 * Local Bridge Integration
 * Enables Web IDE to connect to local filesystem via localhost:3030
 */

export const BRIDGE_INTEGRATION = `
// Local Bridge State
let localBridgeAvailable = false;
const BRIDGE_URL = 'http://127.0.0.1:3030';

// Detect Local Bridge with retries
window.detectLocalBridge = async function() {
  const maxRetries = 3;
  const retryDelay = 500; // ms

  for (let i = 0; i < maxRetries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      const res = await fetch(BRIDGE_URL + '/health', {
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok') {
          localBridgeAvailable = true;
          console.log('✅ Local Bridge Connected:', data.workspace);
          window.updateModeIndicator('local');

          // Sync cloud state to local on connect
          window.syncCloudToLocal().catch(console.warn);

          return true;
        }
      }
    } catch (e) {
      console.log('Bridge detection attempt ' + (i+1) + ' failed: ' + e.message);
    }
    await new Promise(r => setTimeout(r, retryDelay));
  }

  localBridgeAvailable = false;
  console.log('☁️  Using Cloud Mode (R2)');
  window.updateModeIndicator('cloud');
  return false;
};

// Auto-reconnect on page focus
window.addEventListener('focus', () => {
  if (!localBridgeAvailable) {
    setTimeout(window.detectLocalBridge, 1000);
  }
});

// Update Mode Indicator
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

// Graceful degradation for failed bridge operations
window.getApiBase = function() {
  return localBridgeAvailable ? BRIDGE_URL : '';
};

window.syncCloudToLocal = async function() {
    const statusEl = document.getElementById('modeIndicator');
    try {
        const cloudFiles = await fetch('/api/fs/list').then(r => r.json());
        const bridgeFiles = await fetch(BRIDGE_URL + '/api/fs/list').then(r => r.json());

        // Skip large generated assets in batch sync to avoid 429s/timeouts
        const unsynced = cloudFiles.filter(cf =>
            !bridgeFiles.some(bf => bf.name === cf.name) &&
            !cf.name.startsWith('generated_')
        );

        if (unsynced.length > 0 && confirm('Sync ' + unsynced.length + ' cloud files to local? (Images skipped)')) {
            let count = 0;
            for (const file of unsynced) {
                count++;
                if (statusEl) statusEl.innerText = 'Syncing... (' + count + '/' + unsynced.length + ')';

                // Helper for throttled fetch with retries
                const fetchWithRetry = async (url, options, retries = 3) => {
                    for (let attempt = 0; attempt < retries; attempt++) {
                        const r = await fetch(url, options);
                        if (r.status === 429) {
                            const wait = (attempt + 1) * 1000;
                            console.warn('Rate limited. Waiting ' + wait + 'ms...');
                            await new Promise(res => setTimeout(res, wait));
                            continue;
                        }
                        return r;
                    }
                    throw new Error('Max retries reached for ' + file.name);
                };

                const res = await fetchWithRetry('/api/fs/file?name=' + encodeURIComponent(file.name));
                const data = await res.json();

                await fetch(BRIDGE_URL + '/api/fs/file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: file.name, content: data.content })
                });

                // Throttling: Wait 200ms between files
                await new Promise(r => setTimeout(r, 200));
            }
            if (statusEl) window.updateModeIndicator('local');
            window.refreshFiles();
        }
    } catch (e) {
        console.error('Sync Error:', e);
        if (statusEl) statusEl.innerText = 'Sync Error';
    }
};

// Override refreshFiles to use bridge
window.refreshFiles = async function() {
    const listEl = document.getElementById('fileList');
    if (listEl) listEl.innerHTML = '<div class="text-slate-500 text-xs p-2">Loading...</div>';
    try {
        const apiBase = window.getApiBase();
        const res = await fetch(apiBase + '/api/fs/list');
        const data = await res.json();

        fileTree = data;
        window.renderFileList(data);
    } catch (e) {
        if (listEl) listEl.innerHTML = '<div class="text-red-400 text-xs p-2">Failed</div>';
    }
};

// Override loadFile to use bridge
window.loadFile = async function(name) {
    activeFile = name;
    const previewContainer = document.getElementById('previewContainer');
    const isMedia = name.match(/\\.(png|jpg|jpeg|gif|webp|glb|gltf)$/i);
    const apiBase = window.getApiBase();

    if (isMedia) {
        previewContainer.style.display = 'block';
        previewContainer.innerHTML = '<div class="flex items-center justify-center h-full text-slate-500 font-mono text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading Media...</div>';
        try {
            const res = await fetch(apiBase + '/api/fs/file?name=' + encodeURIComponent(name));
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
            const res = await fetch(apiBase + '/api/fs/file?name=' + encodeURIComponent(name));
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

// Override saveCurrentFile to use bridge
window.saveCurrentFile = async function(name, content, encoding) {
    if (window.editor && !name.match(/\\.(png|jpg|jpeg|gif|webp|glb|gltf)$/i)) {
        content = window.editor.getValue();
    }

    const apiBase = window.getApiBase();
    await fetch(apiBase + '/api/fs/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, encoding })
    });
};

// Override create/delete for bridge safety
window.createNewFile = async function() {
    const name = prompt("Filename:");
    if (name) {
        const apiBase = window.getApiBase();
        await fetch(apiBase + '/api/fs/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content: '' }) });
        window.refreshFiles();
    }
};

window.deleteFile = async function(name) {
    if (!confirm('Delete ' + name + '?')) return;
    try {
        const apiBase = window.getApiBase();

        // 1. Delete from Cloud (R2) - ALWAYS do this for sync
        try {
            await fetch('/api/fs/file', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
        } catch (cloudErr) {
            console.warn('Cloud deletion failed (stub may remain):', cloudErr);
        }

        // 2. Delete from Local Bridge if available
        if (localBridgeAvailable) {
            await fetch(BRIDGE_URL + '/api/fs/file', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
        }

        window.refreshFiles();
    } catch(e) {
        console.error('Deletion operation failed:', e);
        alert('Failed to delete file from one or more locations.');
    }
};

// Init on page load
window.addEventListener('load', async function() {
    await window.detectLocalBridge();
    if (window.refreshFiles) window.refreshFiles();
});
`;
