// Local Bridge Integration
export const BRIDGE_INTEGRATION = String.raw`
// Local Bridge State
let localBridgeAvailable = false;
const originalAddMessage = (typeof window !== "undefined") ? window.addMessage : null;

// Detect Local Bridge with retries
window.detectLocalBridge = async function() {
  const maxRetries = 3;
  const retryDelay = 500; // ms
  const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";

  for (let i = 0; i < maxRetries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1000);

      const res = await fetch(bridgeUrl + '/health', {
        signal: controller.signal,
        cache: 'no-store',
        // @ts-ignore
        targetAddressSpace: 'local'
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok') {
          localBridgeAvailable = true;
          console.log('✅ Local Bridge Connected:', data.workspace);
          window.updateModeIndicator('local');
          window.connectTerminal();

          // Fetch Global Env
          try {
             const envRes = await fetch(bridgeUrl + '/api/env');
             if (envRes.ok) {
                 const envData = await envRes.json();
                 window.GLOBAL_ENV = envData.env;
                 console.log('🌍 Global Local Env Loaded:', Object.keys(window.GLOBAL_ENV).length + ' vars');
             }
          } catch (e) { console.warn('Failed to load global env:', e); }

          // Sync cloud state to local on connect
          window.syncCloudToLocal().catch(console.warn);

          // Sync UI assets to Local Bridge for offline access
          try {
              const fullHtml = document.documentElement.outerHTML;
              await fetch(bridgeUrl + '/api/bridge/sync-ui', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ html: fullHtml })
              });
              console.log('✅ UI State Synced to Local Bridge (Offline Ready)');
          } catch (e) { console.warn('Failed to sync UI to bridge:', e); }

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
  const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
  return localBridgeAvailable ? bridgeUrl : '';
};

window.syncCloudToLocal = async function() {
    const statusEl = document.getElementById('modeIndicator');
    try {
        const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
        const cloudFiles = await fetch('/api/fs/list').then(r => r.json());
        const bridgeFiles = await fetch(bridgeUrl + '/api/fs/list').then(r => r.json());

        // Skip large generated assets in batch sync to avoid 429s/timeouts
        const unsynced = cloudFiles.filter(cf =>
            !bridgeFiles.some(bf => bf.name === cf.name) &&
            !cf.name.startsWith('generated_')
        );

        if (unsynced.length > 0 && confirm('Sync ' + unsynced.length + ' cloud files to local? (Generated images skipped)')) {
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
                    return null;
                };

                const res = await fetchWithRetry('/api/fs/file?name=' + encodeURIComponent(file.name));
                if (!res) continue;

                const isBinary = file.name.match(/\.(png|jpg|jpeg|glb|gltf|gif|webp|ico)$/i);
                let payload;

                if (isBinary) {
                    const blob = await res.blob();
                    const base64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const res = reader.result;
                            if (typeof res === 'string') resolve(res.split(',')[1]);
                            else resolve('');
                        };
                        reader.readAsDataURL(blob);
                    });
                    payload = { name: file.name, content: base64, encoding: 'base64' };
                } else {
                    const data = await res.json();
                    payload = { name: file.name, content: data.content };
                }

                const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
                await fetch(bridgeUrl + '/api/fs/file', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
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
        if (!res.ok) throw new Error('API down');
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
    const isMedia = name.match(/\.(png|jpg|jpeg|gif|webp|glb|gltf)$/i);
    const apiBase = window.getApiBase();

    if (isMedia) {
        previewContainer.style.display = 'block';
        previewContainer.innerHTML = '<div class="flex items-center justify-center h-full text-slate-500 font-mono text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading Media...</div>';
        try {
            const res = await fetch(apiBase + '/api/fs/file?name=' + encodeURIComponent(name));
            if (!res.ok) throw new Error('Failed to load media');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);

            if (name.match(/\.(glb|gltf)$/i)) {
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
    if (window.editor && !name.match(/\.(png|jpg|jpeg|gif|webp|glb|gltf)$/i)) {
        content = window.editor.getValue();
    }

    const apiBase = window.getApiBase();

    // 1. Save to primary target (Local Bridge if mode=local, else Cloud)
    const primaryRes = await fetch(apiBase + '/api/fs/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, encoding })
    });

    // 2. BACKGROUND CHECKPOINT: Always push to Cloud (R2) if we are in local mode
    // This provides the "persistent progress save" in case of local failure
    if (localBridgeAvailable && primaryRes.ok) {
        fetch('/api/fs/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, content, encoding })
        }).catch(err => console.warn('Cloud checkpoint failed:', err));
    }
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
            const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
            await fetch(bridgeUrl + '/api/fs/file', {
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

// Override ghClone for local bridge
const oldGhClone = window.ghClone;
window.ghClone = async function() {
    if (!localBridgeAvailable) return oldGhClone ? oldGhClone() : null;

    const repoInput = document.getElementById('ghRepo');
    const repoRaw = repoInput?.value;
    if (!repoRaw) return alert("Enter repo (owner/repo)");

    const btn = document.querySelector('button[onclick="window.ghClone()"]');
    const oldText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-laptop"></i> Fast Cloning...';

    try {
        // Support raw git URLs (SSH or HTTPS) for global settings
        const cloneCommand = repoRaw.includes('://') || repoRaw.startsWith('git@')
            ? 'git clone ' + repoRaw + ' .'
            : 'git clone https://github.com/' + repoRaw + ' .';

        // Local clone using CLI
        const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
        const res = await fetch(bridgeUrl + '/api/terminal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cloneCommand })
        });
        const d = await res.json();
        alert('Local Clone Output:\\n' + d.output);
        window.refreshFiles();
    } catch (e) {
        alert('Local Clone Failed: ' + e.message);
    } finally { btn.innerHTML = oldText; }
};

// --- Persistent Terminal Integration ---
let terminalWs = null;

window.connectTerminal = function() {
    if (terminalWs) return;
    const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
    const wsUrl = bridgeUrl.replace('http', 'ws');

    console.log('🔌 Connecting Terminal WebSocket...');
    terminalWs = new WebSocket(wsUrl);

    terminalWs.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            const output = document.getElementById('terminalOutput');
            if (output && msg.data) {
                output.innerText += msg.data;
                output.scrollTop = output.scrollHeight;
            }
        } catch(e) {}
    };

    terminalWs.onclose = () => {
        console.log('🔌 Terminal WebSocket Closed. Retrying in 5s...');
        terminalWs = null;
        setTimeout(window.connectTerminal, 5000);
    };
};

// Handle Terminal Input
document.getElementById('terminalInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const cmd = e.target.value;
        if (!cmd) return;

        if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
            terminalWs.send(JSON.stringify({ type: 'input', command: cmd }));
            e.target.value = '';
        } else {
            console.warn('Terminal not connected.');
        }
    }
});

// Redirect Deploy/Clone Hooks
window.deployProject = async function() {
    if (!localBridgeAvailable) return alert('Bridge required for local deployment.');
    const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
    if (window.addMessage) window.addMessage('ai', '🚀 **Starting Local Deployment via Wrangler...**', true);

    try {
        const res = await fetch(bridgeUrl + '/api/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'wrangler deploy' })
        });
        const d = await res.json();
        if (window.addMessage) window.addMessage('ai', '✅ **Deployment Complete**\\n' + (d.stdout || d.error), true);
    } catch (e) {
        if (window.addMessage) window.addMessage('ai', '❌ **Deployment Failed**: ' + e.message, true);
    }
};

// Override addMessage to use original logic plus local redirects
window.addMessageDirect = function(role, text, isMarkdown) {
    if (role === 'ai' && localBridgeAvailable) {
        // Use single-escaped brackets for literal matching in regex
        const githubMatch = text.match(/\[GITHUB: push (.*?):(.*?):(.*?)\]/i);
        if (githubMatch) {
            const [_, repoPath, branch, msg] = githubMatch;
            console.log('🚀 Redirecting GitHub push to Local Bridge...');

            const runPush = async () => {
                try {
                    // Local Git sequence
                    const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
                    await fetch(bridgeUrl + '/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'git add .' }) });
                    await fetch(bridgeUrl + '/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'git commit -m "' + msg + '"' }) });
                    const res = await fetch(bridgeUrl + '/api/terminal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: 'git push origin ' + branch }) });
                    const d = await res.json();
                    if (window.addMessage) window.addMessage('ai', '✅ **Local Git Push Complete**\\n' + d.output, true);
                } catch (e) {
                    if (window.addMessage) window.addMessage('ai', '❌ **Local Git Push Failed**: ' + e.message, true);
                }
            };
            runPush();
            return; // Intercepted
        }
    }
    if (originalAddMessage) return originalAddMessage(role, text, isMarkdown);
};

// Init on page load
window.addEventListener('load', async function() {
    await window.detectLocalBridge();
    if (window.refreshFiles) window.refreshFiles();
});
`;
