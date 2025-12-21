// file: local-bridge/server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const WebSocket = require('ws');

const execAsync = promisify(exec);
const LOG_FILE = path.join(process.cwd(), 'bridge.log');

async function logBridge(msg) {
  const timestamp = new Date().toISOString();
  await fs.appendFile(LOG_FILE, `[${timestamp}] ${msg}\n`).catch(() => { });
}

logBridge("Bridge Server Starting...");
const app = express();
const PORT = 3040;

// Create HTTP server to share with WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// CORS: Allow Web IDE to connect and support Private Network Access (PNA)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  else res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-AI-Provider, Access-Control-Request-Private-Network');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '50mb' }));

// Working directory (configurable)
const DEFAULT_WORKSPACE = path.join(process.cwd(), 'workspace');
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || DEFAULT_WORKSPACE;

// Ensure workspace exists
fs.mkdir(WORKSPACE_ROOT, { recursive: true }).catch(err => console.error('Failed to create workspace:', err));

console.log(`🏠 Workspace Root: ${WORKSPACE_ROOT}`);

// --- Persistent PowerShell Engine ---
let activeShell = null;
let shellOutputBuffer = '';

function getActiveShell() {
  if (activeShell && !activeShell.killed) return activeShell;

  console.log('🚀 Spawning Persistent PowerShell Session...');
  activeShell = spawn('powershell.exe', ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', '-'], {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, TERM: 'xterm-256color' },
    shell: false
  });

  activeShell.stdout.on('data', (data) => {
    const str = data.toString();
    shellOutputBuffer += str;
    broadcastToTerminals({ type: 'output', data: str });
  });

  activeShell.stderr.on('data', (data) => {
    const str = data.toString();
    shellOutputBuffer += str;
    broadcastToTerminals({ type: 'output', data: str, isError: true });
  });

  activeShell.on('exit', (code) => {
    console.log(`⚠️ PowerShell exited with code ${code}`);
    broadcastToTerminals({ type: 'system', data: `Shell exited with code ${code}. Restarting...` });
    activeShell = null;
  });

  return activeShell;
}

function broadcastToTerminals(msg) {
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// WebSocket Setup
wss.on('connection', (ws) => {
  console.log('🔌 Terminal UI Connected via WebSocket');

  // Send current buffer to new connection
  ws.send(JSON.stringify({ type: 'output', data: shellOutputBuffer }));

  ws.on('message', (message) => {
    const shell = getActiveShell();
    try {
      const data = JSON.parse(message);
      if (data.type === 'input') {
        shell.stdin.write(data.command + '\n');
      }
    } catch (e) {
      // Raw text fallback
      shell.stdin.write(message.toString() + '\n');
    }
  });
});

// Serve the IDE dashboard locally for offline-first resilience
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Cloudflare Code Agent (Local)</title>
        <style>
          body { background: #020617; color: #67e8f9; font-family: monospace; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .btn { background: #164e63; color: #22d3ee; padding: 1rem 2rem; border-radius: 0.5rem; text-decoration: none; border: 1px solid #22d3ee40; transition: all 0.2s; }
          .btn:hover { background: #0891b2; border-color: #22d3ee; }
        </style>
      </head>
      <body>
        <h1 style="margin-bottom: 2rem;">🛡️ Local IDE Bridge Active</h1>
        <a href="/ide" class="btn">Launch Hybrid IDE</a>
        <p style="margin-top: 2rem; color: #475569; font-size: 0.8rem;">Syncing: ${WORKSPACE_ROOT}</p>
      </body>
    </html>
  `);
});

// Proxy for the IDE HTML
let cloudIdeHtml = '';
app.get('/ide', (req, res) => {
  if (!cloudIdeHtml) {
    return res.send(`
            <html>
                <body style="background:#020617; color:#67e8f9; font-family:monospace; padding:2rem;">
                    <h1>IDE UI Not Synced</h1>
                    <p>Connect to the Cloud Worker once while online to sync the latest UI assets.</p>
                    <button onclick="location.reload()">Retry</button>
                </body>
            </html>
        `);
  }
  res.send(cloudIdeHtml);
});

app.post('/api/bridge/sync-ui', (req, res) => {
  const { html } = req.body;
  if (html) {
    cloudIdeHtml = html;
    console.log('✨ UI Assets Synced from Cloud Worker');
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Missing HTML' });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'local',
    workspace: WORKSPACE_ROOT,
    version: '1.1.0'
  });
});

// FS API
app.get('/api/fs/list', async (req, res) => {
  try {
    const files = await listFilesRecursive(WORKSPACE_ROOT);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/fs/file', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Missing name parameter' });
    const filePath = path.join(WORKSPACE_ROOT, name);
    if (!filePath.startsWith(WORKSPACE_ROOT)) return res.status(403).json({ error: 'Access denied' });

    const isBinary = name.match(/\.(png|jpg|jpeg|glb|gltf|gif|webp)$/i);
    if (isBinary) {
      const buffer = await fs.readFile(filePath);
      return res.send(buffer);
    }
    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/fs/file', async (req, res) => {
  try {
    const { name, content, encoding } = req.body;
    const filePath = path.join(WORKSPACE_ROOT, name);
    if (!filePath.startsWith(WORKSPACE_ROOT)) return res.status(403).json({ error: 'Access denied' });

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    if (encoding === 'base64') {
      await fs.writeFile(filePath, Buffer.from(content, 'base64'));
    } else {
      await fs.writeFile(filePath, content || '', 'utf-8');
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/fs/file', async (req, res) => {
  try {
    const { name } = req.body;
    const filePath = path.join(WORKSPACE_ROOT, name);
    if (!filePath.startsWith(WORKSPACE_ROOT)) return res.status(403).json({ error: 'Access denied' });
    await fs.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.all('/api/fs/search', async (req, res) => {
  try {
    const pattern = req.query.pattern || req.body.pattern;
    if (!pattern) return res.status(400).json({ error: 'Missing pattern' });
    const allFiles = await listFilesRecursive(WORKSPACE_ROOT);
    const results = [];
    for (const file of allFiles) {
      if (shouldIgnore(file.name)) continue;
      if (file.name.match(/\.(png|jpg|jpeg|glb|gltf|gif|webp|woff2|ttf|mp3|wav|ogg)$/i)) continue;
      try {
        const filePath = path.join(WORKSPACE_ROOT, file.name);
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(pattern.toLowerCase())) {
            results.push({ file: file.name, line: index + 1, content: line.trim().substring(0, 200) });
          }
        });
      } catch (e) { }
      if (results.length > 100) break;
    }
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Synchronous Exec (for agentic tool calls)
app.post('/api/exec', async (req, res) => {
  try {
    const { command, persistent = false } = req.body;
    if (!command) return res.status(400).json({ error: 'Missing command' });

    await logBridge(`EXEC (persistent=${persistent}): ${command}`);
    console.log(`💻 Executing: ${command}`);

    if (persistent) {
      const shell = getActiveShell();
      const sentinel = `___SENTINEL_${Date.now()}___`;
      let output = '';

      const onData = (data) => {
        const str = data.toString();
        if (str.includes(sentinel)) {
          output += str.replace(sentinel, '');
          finish();
        } else {
          output += str;
        }
      };

      const cleanup = () => {
        shell.stdout.removeListener('data', onData);
        shell.stderr.removeListener('data', onData);
        clearTimeout(timeout);
      };

      const timeout = setTimeout(() => {
        cleanup();
        res.json({ success: false, error: 'Command timed out', stdout: output });
      }, 30000);

      const finish = () => {
        cleanup();
        res.json({ success: true, stdout: output.trim() });
      };

      shell.stdout.on('data', onData);
      shell.stderr.on('data', onData);

      shell.stdin.write(`${command}; echo "${sentinel}"\n`);
      return;
    }

    // Standard single-shot execution
    const shellCmd = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-Command', command] : ['-c', command];
    const { stdout, stderr } = await execAsync(`"${shellCmd}" ${shellArgs.slice(2).join(' ')}`, {
      cwd: WORKSPACE_ROOT,
      timeout: 30000,
      env: { ...process.env }
    });
    res.json({ stdout: stdout || '', stderr: stderr || '', success: true });
  } catch (error) {
    res.status(500).json({ error: error.message, stdout: error.stdout || '', stderr: error.stderr || '', success: false });
  }
});

// Legacy Terminal API (Pipes to persistent shell)
app.post('/api/terminal', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Missing command' });
    const shell = getActiveShell();
    shell.stdin.write(command + '\n');
    res.json({ output: 'Command sent to persistent shell...', success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Antigravity IDE Context API
const ANTIGRAVITY_USER_DATA = path.join(process.env.APPDATA || '', 'Antigravity');
const ANTIGRAVITY_SETTINGS = path.join(ANTIGRAVITY_USER_DATA, 'User', 'settings.json');
const ANTIGRAVITY_MCP = path.join(ANTIGRAVITY_USER_DATA, 'User', 'mcp.json');

app.get('/api/antigravity/context', async (req, res) => {
  try {
    const settings = await fs.readFile(ANTIGRAVITY_SETTINGS, 'utf-8').then(JSON.parse).catch(() => ({}));
    const mcp = await fs.readFile(ANTIGRAVITY_MCP, 'utf-8').then(JSON.parse).catch(() => ({}));

    // Get latest bridge logs as a proxy for "recent session context"
    const logs = await fs.readFile(LOG_FILE, 'utf-8').catch(() => "");
    const recentLogs = logs.split('\n').slice(-50).join('\n');

    res.json({
      settings,
      mcp,
      recentLogs,
      workspaceRoot: WORKSPACE_ROOT,
      bridgeActive: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- GitKraken MCP Bridge ---
const GK_PATH = path.join(ANTIGRAVITY_USER_DATA, 'User', 'globalStorage', 'eamodio.gitlens', 'gk.exe');
let gkProcess = null;
const mcpRequests = new Map();

function getGkProcess() {
  if (gkProcess && !gkProcess.killed) return gkProcess;

  console.log('🔗 Connecting to GitKraken MCP Server...');
  gkProcess = spawn(GK_PATH, [
    "mcp",
    "--host=antigravity",
    "--source=gitlens",
    "--scheme=antigravity"
  ], {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env }
  });

  let buffer = '';
  gkProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    let lines = buffer.split('\n');
    buffer = lines.pop(); // Keep partial line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        if (response.id && mcpRequests.has(response.id)) {
          mcpRequests.get(response.id)(response);
          mcpRequests.delete(response.id);
        }
      } catch (e) {
        console.error('Failed to parse MCP response:', line);
      }
    }
  });

  gkProcess.stderr.on('data', (data) => {
    console.warn(`[GK-MCP ERROR] ${data.toString()}`);
  });

  gkProcess.on('exit', () => {
    console.log('⚠️ GitKraken MCP exited.');
    gkProcess = null;
  });

  return gkProcess;
}

app.post('/api/mcp/gitkraken', async (req, res) => {
  try {
    const gk = getGkProcess();
    const requestId = Date.now().toString();
    const payload = { ...req.body, jsonrpc: "2.0", id: requestId };

    const timeout = setTimeout(() => {
      if (mcpRequests.has(requestId)) {
        mcpRequests.delete(requestId);
        res.status(504).json({ error: 'GitKraken MCP Timeout' });
      }
    }, 10000);

    mcpRequests.set(requestId, (response) => {
      clearTimeout(timeout);
      res.json(response);
    });

    gk.stdin.write(JSON.stringify(payload) + '\n');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Environment API
app.get('/api/env', (req, res) => {
  res.json({ env: process.env, platform: process.platform, nodeVersion: process.version });
});

// Blender API
const BLENDER_EXECUTABLE = process.env.BLENDER_PATH || "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe";
app.post('/api/blender/run', async (req, res) => {
  try {
    const { script, args = [] } = req.body;
    const tempScriptPath = path.join(WORKSPACE_ROOT, '.blender_temp_script.py');
    await fs.writeFile(tempScriptPath, script);
    const blenderCmd = `"${BLENDER_EXECUTABLE}" -b -P "${tempScriptPath}" -- ${args.join(' ')}`;
    const { stdout, stderr } = await execAsync(blenderCmd, { cwd: WORKSPACE_ROOT, timeout: 120000 });
    await fs.unlink(tempScriptPath).catch(() => { });
    res.json({ success: true, output: stdout, errors: stderr });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helpers
async function listFilesRecursive(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (shouldIgnore(entry.name)) continue;
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath, baseDir)));
    } else {
      const stat = await fs.stat(fullPath);
      files.push({ name: relativePath, size: stat.size, uploaded: stat.mtime });
    }
  }
  return files;
}

function shouldIgnore(name) {
  return ['node_modules', '.git', 'dist', 'build', '.next', '.env', '.DS_Store'].includes(name) || name.startsWith('.');
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🌉 Local Bridge Server running on http://127.0.0.1:${PORT}`);
  console.log(`🔌 WebSocket Stream Active on port ${PORT}`);
});

process.on('uncaughtException', (err) => console.error('💥 Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('💥 Unhandled Rejection:', reason));
