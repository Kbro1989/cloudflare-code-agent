// Local Bridge Integration
export const BRIDGE_INTEGRATION = String.raw`
// Local Bridge State
let localBridgeAvailable = false;
let taskQueueMode = false; // True when using cloud-to-local task queue
const originalAddMessage = (typeof window !== "undefined") ? window.addMessage : null;

// Task Queue Helper - Submits task to cloud and polls for result
window.runLocalTask = async function(type, payload, timeoutMs = 60000) {
  const res = await fetch('/api/task/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, payload })
  });
  if (!res.ok) throw new Error('Failed to queue task: ' + res.status);
  const { taskId } = await res.json();

  // Poll for result
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, 200)); // Faster polling (200ms)
    const resultRes = await fetch('/api/task/result?taskId=' + taskId);
    const result = await resultRes.json();
    if (result.status === 'complete') {
      if (result.error) throw new Error(result.error);
      return result.result;
    }
  }
  throw new Error('Task timeout: ' + type);
};

// Check if Task Queue is available (Task Runner CLI is running)
window.checkTaskQueueMode = async function() {
  if (window.location.protocol !== 'https:') return false;
  try {
    // Perform a quick list operation to verify connectivity
    const result = await window.runLocalTask('fs.list', { path: '' }, 15000); // 15s timeout for first check
    if (result && Array.isArray(result)) {
      taskQueueMode = true;
      console.log('🔄 Task Queue Mode: Active (Task Runner CLI connected)');
      window.updateModeIndicator('local');
      return true;
    }
  } catch (e) {
    console.log('☁️ Task Queue Mode: Inactive (' + e.message + ')');
  }
  return false;
};


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

  // Try Task Queue Mode (requires Task Runner CLI to be running)
  if (window.location.protocol === 'https:') {
    console.log('🔄 Checking Task Queue Mode...');
    const taskQueueAvailable = await window.checkTaskQueueMode();
    if (taskQueueAvailable) {
      return true; // Task queue working, local file access enabled
    }
    console.log('💡 To enable local file access: node local-bridge/task-runner.js');
  }

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

// Override refreshFiles to use bridge or task queue
window.refreshFiles = async function() {
    const listEl = document.getElementById('fileList');
    if (listEl) listEl.innerHTML = '<div class="text-slate-500 text-xs p-2">Loading...</div>';
    try {
        let data;
        if (localBridgeAvailable) {
            const apiBase = window.getApiBase();
            const res = await fetch(apiBase + '/api/fs/list');
            if (!res.ok) throw new Error('API down');
            data = await res.json();
        } else if (taskQueueMode) {
            // Use task queue for local file access from production URL
            data = await window.runLocalTask('fs.list', { path: '' }, 10000);
        } else {
            // Fall back to cloud R2
            const res = await fetch('/api/fs/list');
            if (!res.ok) throw new Error('API down');
            data = await res.json();
        }
        fileTree = data;
        window.renderFileList(data);
    } catch (e) {
        if (listEl) listEl.innerHTML = '<div class="text-red-400 text-xs p-2">Failed</div>';
    }
};

// Override loadFile to use bridge or task queue
window.loadFile = async function(name) {
    activeFile = name;
    const previewContainer = document.getElementById('previewContainer');
    const isMedia = name.match(/\.(png|jpg|jpeg|gif|webp|glb|gltf)$/i);
    const apiBase = window.getApiBase();

    if (isMedia) {
        previewContainer.style.display = 'block';
        previewContainer.innerHTML = '<div class="flex items-center justify-center h-full text-slate-500 font-mono text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading Media...</div>';
        try {
            let url;
            if (localBridgeAvailable) {
                const res = await fetch(apiBase + '/api/fs/file?name=' + encodeURIComponent(name));
                if (!res.ok) throw new Error('Failed to load media');
                const blob = await res.blob();
                url = URL.createObjectURL(blob);
            } else if (taskQueueMode) {
                const data = await window.runLocalTask('fs.read', { name, encoding: 'base64' }, 30000);
                url = 'data:application/octet-stream;base64,' + data.content;
            } else {
                const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
                if (!res.ok) throw new Error('Failed to load media');
                const blob = await res.blob();
                url = URL.createObjectURL(blob);
            }

            if (name.match(/\.(glb|gltf)$/i)) {
                previewContainer.innerHTML = '<model-viewer src="' + url + '" camera-controls auto-rotate style="width:100%;height:100%"></model-viewer>';
            } else {
                previewContainer.innerHTML = '<div class="flex items-center justify-center h-full bg-slate-900/50 backdrop-blur-sm p-4">' +
                    '<img src="' + url + '" class="max-w-full max-h-full shadow-2xl rounded-lg border border-white/10">' +
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
            let content;
            if (localBridgeAvailable) {
                const res = await fetch(apiBase + '/api/fs/file?name=' + encodeURIComponent(name));
                const d = await res.json();
                content = d.content;
            } else if (taskQueueMode) {
                const data = await window.runLocalTask('fs.read', { name }, 10000);
                content = data.content;
            } else {
                const res = await fetch('/api/fs/file?name=' + encodeURIComponent(name));
                const d = await res.json();
                content = d.content;
            }

            currentCode = content;
            if (editor) {
                const model = editor.getModel();
                monaco.editor.setModelLanguage(model, window.getLanguage(name));
                editor.setValue(content);
            }
        } catch(e){}
    }
    window.renderTabs();
};

// Override saveCurrentFile to use bridge or task queue
window.saveCurrentFile = async function(name, content, encoding) {
    if (window.editor && !name.match(/\.(png|jpg|jpeg|gif|webp|glb|gltf)$/i)) {
        content = window.editor.getValue();
    }

    const apiBase = window.getApiBase();
    let primarySuccess = false;

    // 1. Save to primary target
    try {
        if (localBridgeAvailable) {
            const res = await fetch(apiBase + '/api/fs/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, content, encoding })
            });
            primarySuccess = res.ok;
        } else if (taskQueueMode) {
            await window.runLocalTask('fs.write', { name, content, encoding }, 10000);
            primarySuccess = true;
        } else {
            const res = await fetch('/api/fs/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, content, encoding })
            });
            primarySuccess = res.ok;
        }
    } catch (e) {
        console.error('Save failed:', e);
    }

    // 2. BACKGROUND CHECKPOINT: Always push to Cloud (R2) if we are in local mode
    if ((localBridgeAvailable || taskQueueMode) && primarySuccess) {
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
        if (localBridgeAvailable) {
            const apiBase = window.getApiBase();
            await fetch(apiBase + '/api/fs/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content: '' }) });
        } else if (taskQueueMode) {
            await window.runLocalTask('fs.write', { name, content: '' }, 10000);
        } else {
            await fetch('/api/fs/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, content: '' }) });
        }
        window.refreshFiles();
    }
};

window.deleteFile = async function(name) {
    if (!confirm('Delete ' + name + '?')) return;
    try {
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
        } else if (taskQueueMode) {
            await window.runLocalTask('fs.delete', { name }, 10000);
        }

        window.refreshFiles();
    } catch(e) {
        console.error('Deletion operation failed:', e);
        alert('Failed to delete file from one or more locations.');
    }
};

// Override ghClone for local bridge or task queue
const oldGhClone = window.ghClone;
window.ghClone = async function() {
    if (!localBridgeAvailable && !taskQueueMode) return oldGhClone ? oldGhClone() : null;

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

        let output;
        if (localBridgeAvailable) {
            const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
            const res = await fetch(bridgeUrl + '/api/terminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cloneCommand })
            });
            const d = await res.json();
            output = d.output;
        } else {
            const res = await window.runLocalTask('terminal.exec', { command: cloneCommand }, 120000); // 2 min timeout for clone
            output = res.output || res.error;
        }

        alert('Local Clone Output:\\n' + output);
        window.refreshFiles();
    } catch (e) {
        alert('Local Clone Failed: ' + e.message);
    } finally { btn.innerHTML = oldText; }
};

// Redirect Deploy/Clone Hooks
window.deployProject = async function() {
    if (!localBridgeAvailable && !taskQueueMode) return alert('Bridge required for local deployment.');
    if (window.addMessage) window.addMessage('ai', '🚀 **Starting Local Deployment via Wrangler...**', true);

    const cmd = 'npx wrangler deploy';
    try {
        let output;
        if (localBridgeAvailable) {
            const bridgeUrl = (typeof window.getBridgeUrl === "function") ? window.getBridgeUrl() : "http://localhost:3040";
            const res = await fetch(bridgeUrl + '/api/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd })
            });
            const d = await res.json();
            output = d.output;
        } else {
            const res = await window.runLocalTask('terminal.exec', { command: cmd }, 60000);
            output = res.output || res.error;
        }

        if (window.addMessage) window.addMessage('ai', 'Deployment Output:\\n\`\`\`\\n' + output + '\\n\`\`\`');
    } catch (e) {
        if (window.addMessage) window.addMessage('ai', '❌ Deployment failed: ' + e.message);
    }
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
