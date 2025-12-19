// file: src/ui-bridge.ts
/**
 * Local Bridge Integration
 * Enables Web IDE to connect to local filesystem via localhost:3030
 */

export const BRIDGE_INTEGRATION = `
// Local Bridge State
let localBridgeAvailable = false;
const BRIDGE_URL = 'http://localhost:3030';

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
  try {
    const cloudFiles = await fetch('/api/fs/list').then(r => r.json());
    const bridgeFiles = await fetch(BRIDGE_URL + '/api/fs/list').then(r => r.json());

    const unsynced = cloudFiles.filter(cf => !bridgeFiles.some(bf => bf.name === cf.name));
    if (unsynced.length > 0 && confirm('Sync ' + unsynced.length + ' cloud files to local?')) {
      for (const file of unsynced) {
        const isBinary = file.name.match(/\\.(png|jpg|jpeg|glb|gltf|gif|webp)$/i);
        const res = await fetch('/api/fs/file?name=' + encodeURIComponent(file.name));

        let payload;
        if (isBinary) {
          const blob = await res.blob();
          const base64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
          });
          payload = { name: file.name, content: base64, encoding: 'base64' };
        } else {
          const data = await res.json();
          payload = { name: file.name, content: data.content };
        }

        await fetch(BRIDGE_URL + '/api/fs/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      window.refreshFiles();
    }
  } catch (e) {
    console.error('Sync Error:', e);
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
        const uniqueFiles = new Map();
        data.forEach(f => uniqueFiles.set(f.name, f));
        const files = Array.from(uniqueFiles.values());

        fileTree = files;
        window.renderFileList(files);
    } catch (e) {
        if (listEl) listEl.innerHTML = '<div class="text-red-400 text-xs p-2">Failed</div>';
    }
};

// Override saveCurrentFile to use bridge
window.saveCurrentFile = async function(name, content) {
    if (window.editor && !name.match(/\\.(png|jpg|glb|gltf)$/i)) {
        content = window.editor.getValue();
    }

    const apiBase = window.getApiBase();
    await fetch(apiBase + '/api/fs/file', {
        method: 'POST',
        body: JSON.stringify({ name: name, content: content })
    });
};

// Init on page load
window.addEventListener('load', async function() {
    await window.detectLocalBridge();
    if (window.refreshFiles) window.refreshFiles();
});
`;
