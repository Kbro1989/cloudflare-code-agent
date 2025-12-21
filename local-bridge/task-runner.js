#!/usr/bin/env node
/**
 * Task Runner CLI - Polls cloud worker for pending tasks and executes locally
 * This bypasses PNA by having CLI initiate all connections (outbound only)
 */

const { promises: fs } = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

// Configuration
const WORKER_URL = process.env.WORKER_URL || 'https://cloudflare-code-agent.kristain33rs.workers.dev';
const POLL_INTERVAL = process.env.POLL_INTERVAL || 2000; // 2 seconds
const WORKSPACE = process.env.WORKSPACE_ROOT || process.cwd();

console.log('🌉 Task Runner CLI - PNA Bypass Mode');
console.log(`📡 Worker URL: ${WORKER_URL}`);
console.log(`📁 Workspace: ${WORKSPACE}`);
console.log(`⏱️  Poll Interval: ${POLL_INTERVAL}ms\n`);

// Task Handlers
const handlers = {
  // File system operations
  'fs.list': async (payload) => {
    const dir = path.join(WORKSPACE, payload.path || '');
    const files = await fs.readdir(dir, { withFileTypes: true });
    return files.map(f => ({
      name: f.name,
      isDir: f.isDirectory(),
      path: path.join(payload.path || '', f.name)
    }));
  },

  'fs.read': async (payload) => {
    const filePath = path.join(WORKSPACE, payload.name);
    const content = await fs.readFile(filePath, 'utf-8');
    return { name: payload.name, content };
  },

  'fs.write': async (payload) => {
    const filePath = path.join(WORKSPACE, payload.name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (payload.encoding === 'base64') {
      await fs.writeFile(filePath, Buffer.from(payload.content, 'base64'));
    } else {
      await fs.writeFile(filePath, payload.content);
    }
    return { success: true, path: filePath };
  },

  'fs.delete': async (payload) => {
    const filePath = path.join(WORKSPACE, payload.name);
    await fs.unlink(filePath);
    return { success: true };
  },

  // Terminal command execution
  'terminal.exec': async (payload) => {
    return new Promise((resolve, reject) => {
      exec(payload.command, { cwd: WORKSPACE, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ error: stderr || err.message, exitCode: err.code });
        } else {
          resolve({ output: stdout, error: stderr, exitCode: 0 });
        }
      });
    });
  },

  // Git operations
  'git.status': async () => {
    return new Promise((resolve) => {
      exec('git status --porcelain', { cwd: WORKSPACE }, (err, stdout) => {
        resolve({ status: stdout || '', error: err?.message });
      });
    });
  },

  'git.push': async (payload) => {
    const commands = [
      'git add .',
      `git commit -m "${payload.message || 'Auto-commit from cloud IDE'}"`,
      `git push origin ${payload.branch || 'main'}`
    ];

    let output = '';
    for (const cmd of commands) {
      output += await new Promise((resolve) => {
        exec(cmd, { cwd: WORKSPACE }, (err, stdout, stderr) => {
          resolve(`$ ${cmd}\n${stdout || ''}${stderr || ''}\n`);
        });
      });
    }
    return { output };
  }
};

// Poll for pending tasks
async function pollTasks() {
  try {
    const res = await fetch(`${WORKER_URL}/api/task/pending`);
    if (!res.ok) {
      console.error(`Poll error: ${res.status}`);
      return;
    }

    const { tasks } = await res.json();

    if (tasks && tasks.length > 0) {
      console.log(`\n📥 Found ${tasks.length} pending task(s)`);

      for (const task of tasks) {
        await executeTask(task);
      }
    }
  } catch (err) {
    console.error(`Poll error: ${err.message}`);
  }
}

// Execute a single task
async function executeTask(task) {
  console.log(`\n⚡ Executing: ${task.type} (${task.id})`);

  const handler = handlers[task.type];
  let result, error;

  if (handler) {
    try {
      result = await handler(task.payload || {});
      console.log(`✅ Task completed: ${task.type}`);
    } catch (err) {
      error = err.message;
      console.log(`❌ Task failed: ${task.type} - ${err.message}`);
    }
  } else {
    error = `Unknown task type: ${task.type}`;
    console.log(`⚠️  ${error}`);
  }

  // Report result back to cloud
  try {
    await fetch(`${WORKER_URL}/api/task/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id, result, error })
    });
  } catch (err) {
    console.error(`Failed to report task completion: ${err.message}`);
  }
}

// Main polling loop
console.log('🔄 Starting task poll loop...\n');
setInterval(pollTasks, POLL_INTERVAL);
pollTasks(); // Initial poll

// Keep alive
process.on('SIGINT', () => {
  console.log('\n\n👋 Task Runner stopped');
  process.exit(0);
});
