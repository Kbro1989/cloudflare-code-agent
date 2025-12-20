// file: local-bridge/server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = 3040;

// CORS: Allow Web IDE to connect
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '50mb' }));

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

// Proxy for the IDE HTML (this will be populated from the worker)
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

// Endpoint for worker to push its latest UI assets to local bridge
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

// Working directory (configurable)
// Working directory (configurable)
// Default to ./workspace to avoid cluttering the agent root
const DEFAULT_WORKSPACE = path.join(process.cwd(), 'workspace');
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || DEFAULT_WORKSPACE;

// Ensure workspace exists
fs.mkdir(WORKSPACE_ROOT, { recursive: true }).catch(err => console.error('Failed to create workspace:', err));

console.log(`🏠 Workspace Root: ${WORKSPACE_ROOT}`);

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'local',
    workspace: WORKSPACE_ROOT,
    version: '1.0.0'
  });
});

// List Files
app.get('/api/fs/list', async (req, res) => {
  try {
    const files = await listFilesRecursive(WORKSPACE_ROOT);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get File
app.get('/api/fs/file', async (req, res) => {
  try {
    const name = req.query.name;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Missing name parameter' });

    let filePath;
    try {
      filePath = path.join(WORKSPACE_ROOT, name);
      // Case-insensitive check for Windows
      if (!filePath.toLowerCase().startsWith(WORKSPACE_ROOT.toLowerCase())) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } catch (pe) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const isBinary = name.match(/\.(png|jpg|jpeg|glb|gltf|gif|webp)$/i);

    try {
      await fs.access(filePath);
    } catch {
      // Fallback: try projects/default/ prefix if it doesn't already have it
      if (!name.startsWith('projects/default/')) {
        const fallbackPath = path.join(WORKSPACE_ROOT, 'projects', 'default', name);
        try {
          await fs.access(fallbackPath);
          filePath = fallbackPath;
        } catch {
          return res.status(404).json({ error: `File not found: ${name}` });
        }
      } else {
        return res.status(404).json({ error: `File not found: ${name}` });
      }
    }

    if (isBinary) {
      const buffer = await fs.readFile(filePath);
      return res.send(buffer);
    }

    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content });
  } catch (error) {
    console.error(`❌ GET / api / fs / file error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Save File
app.post('/api/fs/file', async (req, res) => {
  try {
    const { name, content, encoding } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Missing name' });

    let filePath;
    try {
      filePath = path.join(WORKSPACE_ROOT, name);
      if (!filePath.startsWith(WORKSPACE_ROOT)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } catch (pe) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Support base64 for images/binary
    if (encoding === 'base64') {
      const buffer = Buffer.from(content, 'base64');
      await fs.writeFile(filePath, buffer);
    } else {
      await fs.writeFile(filePath, content || '', 'utf-8');
    }

    console.log(`💾 Saved file: ${name}`);
    res.json({ success: true });
  } catch (error) {
    console.error(`❌ POST / api / fs / file error(${req.body.name}): ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete File
app.delete('/api/fs/file', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Missing name' });

    let filePath;
    try {
      filePath = path.join(WORKSPACE_ROOT, name);
      if (!filePath.startsWith(WORKSPACE_ROOT)) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } catch (pe) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    try {
      await fs.unlink(filePath);
    } catch (err) {
      // Fallback: try projects/default/ prefix
      if (!name.startsWith('projects/default/')) {
        const fallbackPath = path.join(WORKSPACE_ROOT, 'projects', 'default', name);
        try {
          await fs.unlink(fallbackPath);
          return res.json({ success: true, note: 'Deleted from projects/default/' });
        } catch {
          // Both failed
          return res.status(404).json({ error: `File not found for deletion: ${name} ` });
        }
      }
      return res.status(404).json({ error: `File not found for deletion: ${name} ` });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(`❌ DELETE / api / fs / file error: ${error.message} `);
    res.status(500).json({ error: error.message });
  }
});

// Search Files (Recursive grep-like)
app.all('/api/fs/search', async (req, res) => {
  try {
    let pattern = req.query.pattern || req.query.q;
    if (req.method === 'POST') {
      pattern = pattern || req.body.pattern;
    }

    if (!pattern) return res.status(400).json({ error: 'Missing pattern' });

    console.log(`🔍 Searching for: "${pattern}"`);
    const allFiles = await listFilesRecursive(WORKSPACE_ROOT);
    const results = [];

    for (const file of allFiles) {
      if (shouldIgnore(file.name)) continue;
      // Skip binary files for text search
      if (file.name.match(/\.(png|jpg|jpeg|glb|gltf|gif|webp|woff2|ttf|mp3|wav|ogg)$/i)) continue;

      try {
        const filePath = path.join(WORKSPACE_ROOT, file.name);
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(pattern.toLowerCase())) {
            results.push({
              file: file.name,
              line: index + 1,
              content: line.trim().substring(0, 200)
            });
          }
        });
      } catch (e) {
        // Skip files that can't be read
      }

      if (results.length > 100) break; // Limit results
    }

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Terminal Execution
app.post('/api/terminal', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Missing command' });

    console.log(`💻 Executing: ${command} `);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: WORKSPACE_ROOT,
        timeout: 30000 // 30s timeout
      });
      res.json({ output: stdout || stderr || 'Command executed successfully', success: true });
    } catch (error) {
      // Return 200 even on command failure so the UI can show the error output
      // without triggering a fetch error in the browser.
      res.json({
        output: error.stderr || error.stdout || error.message,
        success: false,
        exitCode: error.code
      });
    }
  } catch (error) {
    res.status(500).json({
      output: 'Bridge Internal Error: ' + error.message,
      success: false
    });
  }
});

// Environment Variables (Global Context)
app.get('/api/env', (req, res) => {
  try {
    // expose full process.env to allow -g variable discovery
    res.json({
      env: process.env,
      platform: process.platform,
      nodeVersion: process.version
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Blender Configuration
const BLENDER_EXECUTABLE = process.env.BLENDER_PATH || "C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe";

// Blender Script Execution (Background Mode)
app.post('/api/blender/run', async (req, res) => {
  try {
    const { script, args = [] } = req.body;
    if (!script) return res.status(400).json({ error: 'Missing python script' });

    // Save script to temp file in workspace
    const tempScriptPath = path.join(WORKSPACE_ROOT, '.blender_temp_script.py');
    await fs.writeFile(tempScriptPath, script);

    // Build command: blender -b -P script.py -- args
    // -b: Background mode
    // -P: Run python script
    const blenderCmd = `"${BLENDER_EXECUTABLE}" - b - P "${tempScriptPath}" -- ${args.join(' ')} `;

    console.log(`🎬 Running Blender Task...`);

    const { stdout, stderr } = await execAsync(blenderCmd, {
      cwd: WORKSPACE_ROOT,
      timeout: 120000 // 2 minute timeout for 3D tasks
    });

    // Cleanup
    await fs.unlink(tempScriptPath).catch(() => { });

    res.json({
      success: true,
      output: stdout,
      errors: stderr
    });
  } catch (error) {
    // Attempt cleanup
    const tempScriptPath = path.join(WORKSPACE_ROOT, '.blender_temp_script.py');
    await fs.unlink(tempScriptPath).catch(() => { });

    res.status(500).json({
      error: error.message,
      output: error.stdout,
      stderr: error.stderr
    });
  }
});

// Helper: List files recursively
async function listFilesRecursive(dir, baseDir = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    // Skip common ignore patterns
    if (shouldIgnore(entry.name)) continue;

    if (entry.isDirectory()) {
      const subFiles = await listFilesRecursive(fullPath, baseDir);
      files.push(...subFiles);
    } else {
      const stat = await fs.stat(fullPath);
      files.push({
        name: relativePath,
        size: stat.size,
        uploaded: stat.mtime
      });
    }
  }

  return files;
}

function shouldIgnore(name) {
  const ignorePatterns = [
    'node_modules', '.git', 'dist', 'build', '.next',
    '.env', '.DS_Store', 'Thumbs.db', 'src', 'local-bridge',
    'wrangler.toml', 'wrangler.jsonc', 'package.json', 'package-lock.json'
  ];
  return ignorePatterns.includes(name) || name.startsWith('.');
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🌉 Local Bridge Server running on http://127.0.0.1:${PORT}`);
  console.log(`📁 Serving files from: ${WORKSPACE_ROOT}`);
  console.log(`\n✨ Your Web IDE can now access local files!`);
  console.log(`To change workspace: set WORKSPACE_ROOT=/path/to/project`);
});

// Global error handler for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

