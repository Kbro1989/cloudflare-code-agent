#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

// Parse CLI arguments
const args = process.argv.slice(2);
const workspace = args[0] || process.cwd();

// Resolve to absolute path
const absolutePath = path.resolve(workspace);

console.log(`🌉 Starting Local Bridge Server...`);
console.log(`📁 Workspace: ${absolutePath}\n`);

// Set environment variable and spawn server
const server = spawn('node', [path.join(__dirname, 'server.js')], {
  env: { ...process.env, WORKSPACE_ROOT: absolutePath },
  stdio: 'inherit',
  shell: true
});

server.on('error', (error) => {
  console.error(`❌ Failed to start server: ${error.message}`);
  process.exit(1);
});

server.on('exit', (code) => {
  if (code !== 0) {
    console.log(`\n⚠️  Server exited with code ${code}`);
  }
  process.exit(code);
});

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down Local Bridge Server...');
  server.kill('SIGINT');
});
