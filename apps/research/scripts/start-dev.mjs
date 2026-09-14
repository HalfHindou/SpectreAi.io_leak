#!/usr/bin/env node
/**
 * Start backend server in background, then start Vite dev server.
 * Cross-platform (Windows + Unix). Server runs on port 3001, Vite on 5180.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const isWin = process.platform === 'win32';

const server = spawn(isWin ? 'node' : 'node', [join(root, 'server', 'index.js')], {
  cwd: root,
  stdio: 'inherit',
  shell: isWin,
  env: { ...process.env, PORT: process.env.PORT || '3001' },
});

server.on('error', (err) => {
  console.error('Server failed to start:', err.message);
  process.exit(1);
});

server.on('exit', (code) => {
  if (code !== 0 && code !== null) process.exit(code);
});

// Give server a moment to bind
setTimeout(() => {
  const vite = spawn(isWin ? 'npx.cmd' : 'npx', ['vite'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  vite.on('exit', (code) => {
    server.kill();
    process.exit(code ?? 0);
  });
}, 1500);
