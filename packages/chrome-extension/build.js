/**
 * Spectre AI Chrome Extension — Build Script
 * Uses esbuild to bundle content scripts and background service worker
 * Copies static assets to dist/
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const DIST = path.resolve(__dirname, 'dist');

// Ensure dist directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Copy a file
function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

// Copy a directory recursively
function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

async function build() {
  console.log('[Build] Starting...');

  // Clean dist
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  ensureDir(DIST);

  // Bundle content script — X/Twitter (IIFE, no ES modules)
  await esbuild.build({
    entryPoints: ['content/content-script.js'],
    bundle: true,
    format: 'iife',
    outfile: path.join(DIST, 'content/content-script.js'),
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
    target: ['chrome120'],
  });
  console.log('[Build] Content script (X) bundled');

  // Bundle content script — DexScreener (standalone IIFE, no imports)
  await esbuild.build({
    entryPoints: ['content/content-dex.js'],
    bundle: true,
    format: 'iife',
    outfile: path.join(DIST, 'content/content-dex.js'),
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
    target: ['chrome120'],
  });
  console.log('[Build] Content script (DexScreener) bundled');

  // Bundle background service worker (IIFE — single bundled file)
  await esbuild.build({
    entryPoints: ['background/service-worker.js'],
    bundle: true,
    format: 'iife',
    outfile: path.join(DIST, 'background/service-worker.js'),
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
    target: ['chrome120'],
  });
  console.log('[Build] Service worker bundled');

  // Copy static files
  copyFile('manifest.json', path.join(DIST, 'manifest.json'));
  copyFile('shared/design-tokens.css', path.join(DIST, 'shared/design-tokens.css'));
  copyFile('shared/glass-ui.css', path.join(DIST, 'shared/glass-ui.css'));

  // Copy DexScreener content CSS
  copyFile('content/content-dex.css', path.join(DIST, 'content/content-dex.css'));

  // Copy popup
  copyFile('popup/popup.html', path.join(DIST, 'popup/popup.html'));
  copyFile('popup/popup.css', path.join(DIST, 'popup/popup.css'));
  copyFile('popup/popup.js', path.join(DIST, 'popup/popup.js'));

  // Copy registry
  copyFile('registry/known-tokens.json', path.join(DIST, 'registry/known-tokens.json'));

  // Copy assets
  if (fs.existsSync('assets')) {
    copyDir('assets', path.join(DIST, 'assets'));
  }

  console.log('[Build] Static files copied');
  console.log('[Build] Done! Extension ready in dist/');
}

build().catch(err => {
  console.error('[Build] Failed:', err);
  process.exit(1);
});

if (isWatch) {
  console.log('[Build] Watching for changes...');
  // Simple watch: rebuild on file changes
  const dirs = ['content', 'background', 'shared', 'popup', 'registry'];
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      fs.watch(dir, { recursive: true }, () => {
        console.log('[Build] Change detected, rebuilding...');
        build().catch(console.error);
      });
    }
  }
}
