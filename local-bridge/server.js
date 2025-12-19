// file: local-bridge/server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = 3030;

// CORS: Allow Web IDE to connect
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '50mb' }));

// Working directory (configurable)
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();

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
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'Missing name parameter' });

    const filePath = path.join(WORKSPACE_ROOT, name);

    // Security: Prevent directory traversal
    if (!filePath.startsWith(WORKSPACE_ROOT)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const content = await fs.readFile(filePath, 'utf-8');
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save File
app.post('/api/fs/file', async (req, res) => {
  try {
    const { name, content, encoding } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });

    const filePath = path.join(WORKSPACE_ROOT, name);

    // Security check
    if (!filePath.startsWith(WORKSPACE_ROOT)) {
      return res.status(403).json({ error: 'Access denied' });
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

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete File
app.delete('/api/fs/file', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });

    const filePath = path.join(WORKSPACE_ROOT, name);

    if (!filePath.startsWith(WORKSPACE_ROOT)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.unlink(filePath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Terminal Execution
app.post('/api/terminal', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Missing command' });

    const { stdout, stderr } = await execAsync(command, {
      cwd: WORKSPACE_ROOT,
      timeout: 30000 // 30s timeout
    });

    res.json({ output: stdout || stderr || 'Command executed successfully' });
  } catch (error) {
    res.status(500).json({
      output: error.stderr || error.stdout || error.message
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
    '.env', '.DS_Store', 'Thumbs.db'
  ];
  return ignorePatterns.includes(name) || name.startsWith('.');
}

app.listen(PORT, () => {
  console.log(`\n🌉 Local Bridge Server running on http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${WORKSPACE_ROOT}`);
  console.log(`\n✨ Your Web IDE can now access local files!`);
  console.log(`\nTo change workspace: set WORKSPACE_ROOT=/path/to/project\n`);
});
