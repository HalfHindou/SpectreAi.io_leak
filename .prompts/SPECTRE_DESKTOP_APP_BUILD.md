# SPECTRE DESKTOP APP — CLAUDE CODE BUILD INSTRUCTIONS

## WHAT YOU ARE BUILDING

An Electron desktop application that wraps the existing Spectre AI web app.
The desktop app adds: system tray, global hotkeys, native notifications,
and lays the foundation for Spectre Lens (screen-aware overlay — Phase 2).

Build Mac first. Windows compatibility kept in mind throughout.

---

## STEP 0 — READ BEFORE WRITING A SINGLE LINE

Read these files first in this order:
1. SPECTRE_DESIGN_LAW.md — design rules apply to all native UI (tray menu, splash screen)
2. package.json in the root — understand the existing app structure
3. src/index.css — design tokens you will reference

Do NOT read entire large files. Use grep and offset/limit.

---

## STEP 1 — UNDERSTAND THE EXISTING APP

```bash
# What framework is the web app?
cat package.json | grep -E '"react|"vite|"next|"scripts'

# What port does dev server run on?
grep -r "port\|localhost\|3000\|5173" vite.config.* package.json 2>/dev/null | head -10

# What is the build output folder?
grep -r "outDir\|build\|dist" vite.config.* next.config.* 2>/dev/null | head -10
```

Based on what you find, the Electron app will either:
- In development: load from localhost (e.g. http://localhost:5173)
- In production: load from the built static files in dist/ or build/

---

## STEP 2 — CREATE THE ELECTRON WRAPPER

Create a new folder at the root level: `desktop/`

Structure to create:
```
desktop/
  package.json          ← Electron dependencies
  electron.js           ← Main process (entry point)
  preload.js            ← Secure bridge between main and renderer
  assets/
    icon.png            ← App icon (use existing Spectre logo if available)
    icon.icns           ← Mac icon (convert from png)
    tray-icon.png       ← 22x22 tray icon (dark, for Mac menu bar)
    tray-icon@2x.png    ← 44x44 retina tray icon
  splash/
    index.html          ← Splash screen shown while app loads
```

---

## STEP 3 — desktop/package.json

```json
{
  "name": "spectre-desktop",
  "version": "1.0.0",
  "description": "Spectre AI Desktop — Market Intelligence Platform",
  "main": "electron.js",
  "scripts": {
    "start": "electron .",
    "dev": "SPECTRE_DEV=true electron .",
    "build:mac": "electron-builder --mac",
    "build:win": "electron-builder --win",
    "build:all": "electron-builder --mac --win"
  },
  "build": {
    "appId": "io.spectreai.desktop",
    "productName": "Spectre AI",
    "copyright": "Copyright © 2026 Spectre AI",
    "mac": {
      "category": "public.app-category.finance",
      "icon": "assets/icon.icns",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "target": [
        { "target": "dmg", "arch": ["arm64", "x64"] },
        { "target": "zip", "arch": ["arm64", "x64"] }
      ]
    },
    "win": {
      "icon": "assets/icon.png",
      "target": ["nsis", "portable"]
    },
    "dmg": {
      "title": "Spectre AI",
      "backgroundColor": "#040306"
    },
    "files": [
      "electron.js",
      "preload.js",
      "assets/**",
      "splash/**"
    ],
    "extraResources": [
      {
        "from": "../dist",
        "to": "app",
        "filter": ["**/*"]
      }
    ]
  },
  "dependencies": {
    "electron-store": "^8.1.0"
  },
  "devDependencies": {
    "electron": "^29.0.0",
    "electron-builder": "^24.13.0"
  }
}
```

---

## STEP 4 — desktop/electron.js (Main Process)

```javascript
'use strict';

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  shell,
  nativeImage,
  globalShortcut,
  ipcMain,
  Notification,
  session,
} = require('electron');
const path = require('path');
const Store = require('electron-store');

// ─── Config ─────────────────────────────────────────────────────
const isDev   = process.env.SPECTRE_DEV === 'true';
const DEV_URL = 'http://localhost:5173'; // adjust if app runs on different port
const store   = new Store();

// ─── State ──────────────────────────────────────────────────────
let mainWindow   = null;
let tray         = null;
let splashWindow = null;

// ─── App Ready ──────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Mac: don't show in dock while splash is showing
  if (process.platform === 'darwin') app.dock.hide();

  await createSplash();
  await createMainWindow();
  createTray();
  registerHotkeys();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else mainWindow?.show();
  });
});

// ─── Splash Screen ──────────────────────────────────────────────
async function createSplash() {
  splashWindow = new BrowserWindow({
    width:           480,
    height:          320,
    frame:           false,
    transparent:     true,
    alwaysOnTop:     true,
    skipTaskbar:     true,
    resizable:       false,
    webPreferences:  { nodeIntegration: false, contextIsolation: true },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash', 'index.html'));
  splashWindow.center();
  splashWindow.show();
}

// ─── Main Window ────────────────────────────────────────────────
async function createMainWindow() {
  const bounds = store.get('windowBounds', {
    width: 1440, height: 900, x: undefined, y: undefined,
  });

  mainWindow = new BrowserWindow({
    width:           bounds.width,
    height:          bounds.height,
    x:               bounds.x,
    y:               bounds.y,
    minWidth:        1024,
    minHeight:       700,
    frame:           false,           // custom titlebar
    titleBarStyle:   'hidden',        // Mac: keeps traffic lights
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#040306',       // matches Spectre dark bg — no white flash
    show:            false,           // show after load
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      true,
    },
  });

  // Load the app
  if (isDev) {
    await mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(
      path.join(process.resourcesPath, 'app', 'index.html')
    );
  }

  // Show main window, hide splash
  mainWindow.once('ready-to-show', () => {
    splashWindow?.destroy();
    splashWindow = null;

    mainWindow.show();

    // Show in dock now that main window is ready
    if (process.platform === 'darwin') app.dock.show();

    // Restore maximized state
    if (store.get('isMaximized')) mainWindow.maximize();
  });

  // Save window bounds on move/resize
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move',   saveBounds);
  mainWindow.on('maximize',   () => store.set('isMaximized', true));
  mainWindow.on('unmaximize', () => store.set('isMaximized', false));

  // Intercept external links — open in browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = isDev ? DEV_URL : 'file://';
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Prevent full close — hide to tray instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (process.platform === 'darwin') app.dock.hide();
    }
  });
}

function saveBounds() {
  if (!mainWindow || mainWindow.isMaximized()) return;
  store.set('windowBounds', mainWindow.getBounds());
}

// ─── System Tray ────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets',
    process.platform === 'darwin' ? 'tray-icon.png' : 'tray-icon.png'
  );
  const icon = nativeImage.createFromPath(iconPath);

  // Mac menu bar icons should be template images (white, transparent)
  if (process.platform === 'darwin') icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('Spectre AI');
  tray.setContextMenu(buildTrayMenu());

  // Mac: click tray icon to toggle window
  tray.on('click', () => toggleWindow());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Spectre AI',
      enabled: false,
      // This acts as a header — gray, non-clickable
    },
    { type: 'separator' },
    {
      label: 'Open Spectre',
      accelerator: 'CmdOrCtrl+Shift+S',
      click: () => showWindow(),
    },
    {
      label: 'Search',
      accelerator: 'CmdOrCtrl+Shift+Space',
      click: () => {
        showWindow();
        mainWindow?.webContents.send('spectre:focus-search');
      },
    },
    { type: 'separator' },
    {
      label: 'Spectre Lens',
      enabled: false, // Phase 2 — grayed out for now
      toolTip: 'Coming soon',
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        showWindow();
        mainWindow?.webContents.send('spectre:open-settings');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Spectre',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function showWindow() {
  if (!mainWindow) return;
  if (process.platform === 'darwin') app.dock.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow?.isVisible()) {
    mainWindow.hide();
    if (process.platform === 'darwin') app.dock.hide();
  } else {
    showWindow();
  }
}

// ─── Global Hotkeys ─────────────────────────────────────────────
function registerHotkeys() {
  // Open / focus Spectre
  globalShortcut.register('CommandOrControl+Shift+S', () => showWindow());

  // Focus search bar from anywhere
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    showWindow();
    mainWindow?.webContents.send('spectre:focus-search');
  });

  // Phase 2 placeholder — Lens activation hotkey
  // globalShortcut.register('CommandOrControl+Shift+L', () => activateLens());
}

// ─── IPC Handlers ───────────────────────────────────────────────

// App version
ipcMain.handle('app:version',  () => app.getVersion());

// Window controls (for custom titlebar)
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close',    () => mainWindow?.hide());

// Desktop notifications
ipcMain.on('notify:breaking', (_, { title, body }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    silent: false,
  });
  n.on('click', () => {
    showWindow();
    mainWindow?.webContents.send('spectre:open-notifications');
  });
  n.show();
});

// Store access (for persisting user preferences)
ipcMain.handle('store:get', (_, key)        => store.get(key));
ipcMain.handle('store:set', (_, key, value) => store.set(key, value));

// ─── App Lifecycle ───────────────────────────────────────────────
app.on('window-all-closed', () => {
  // On Mac, keep app running in tray even with no windows
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
```

---

## STEP 5 — desktop/preload.js

```javascript
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, typed API to the renderer (the Spectre web app)
// The web app accesses this via window.spectre
contextBridge.exposeInMainWorld('spectre', {

  // Environment
  isDesktop: true,
  platform:  process.platform, // 'darwin' | 'win32' | 'linux'

  // App info
  version: () => ipcRenderer.invoke('app:version'),

  // Window controls (for custom titlebar buttons)
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),

  // Desktop notifications (breaking news, alerts)
  notify: (title, body) => ipcRenderer.send('notify:breaking', { title, body }),

  // Persistent store
  store: {
    get: (key)         => ipcRenderer.invoke('store:get', key),
    set: (key, value)  => ipcRenderer.invoke('store:set', key, value),
  },

  // Listen for main process events
  on: (channel, callback) => {
    const allowed = [
      'spectre:focus-search',
      'spectre:open-settings',
      'spectre:open-notifications',
      'lens:result',
      'lens:state',
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.on(channel, (_, data) => callback(data));
    }
  },

  // Remove listener
  off: (channel, callback) => ipcRenderer.removeListener(channel, callback),
});
```

---

## STEP 6 — desktop/splash/index.html

Animated splash screen. Sequence: orbit rings fade in → logo mark pulses in
→ wordmark types in → tagline fades → progress bar fills → whole screen fades out.
Total duration ~2.4 seconds. Feels premium, not slow.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      width: 480px;
      height: 320px;
      background: linear-gradient(168deg, #07060a 0%, #09080d 35%, #040306 70%, #020103 100%);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      overflow: hidden;
      -webkit-app-region: drag;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      opacity: 1;
      transition: opacity 0.4s ease;
    }

    body.fade-out { opacity: 0; }

    /* ── Orbit animation ── */
    .orbit-container {
      position: relative;
      width: 96px;
      height: 96px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      animation: fadeIn 0.4s ease 0.1s forwards;
    }

    /* Outer ring — slow rotation */
    .ring {
      position: absolute;
      border-radius: 50%;
      border: 1px solid transparent;
      animation: spin 4s linear infinite;
    }

    .ring-1 {
      width: 90px;
      height: 90px;
      border-top-color:   rgba(139,92,246,0.5);
      border-right-color: rgba(139,92,246,0.15);
      animation-duration: 3s;
    }

    .ring-2 {
      width: 74px;
      height: 74px;
      border-bottom-color: rgba(6,182,212,0.4);
      border-left-color:   rgba(6,182,212,0.1);
      animation-duration: 2.2s;
      animation-direction: reverse;
    }

    .ring-3 {
      width: 58px;
      height: 58px;
      border-top-color:   rgba(139,92,246,0.2);
      border-right-color: rgba(139,92,246,0.6);
      animation-duration: 5s;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }

    /* Center logo mark */
    .logo-mark {
      position: absolute;
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, rgba(139,92,246,0.2), rgba(6,182,212,0.1));
      border: 1px solid rgba(139,92,246,0.4);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow:
        0 0 20px rgba(139,92,246,0.25),
        inset 0 1px 0 rgba(255,255,255,0.1);
      opacity: 0;
      transform: scale(0.7);
      animation: markIn 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.35s forwards;
    }

    /* Use your actual SVG logo here.
       Replace the S with: <img src="../assets/icon.png" width="20" height="20"> */
    .logo-mark svg {
      width: 20px;
      height: 20px;
      fill: none;
    }

    .logo-mark .fallback {
      font-size: 18px;
      line-height: 1;
    }

    @keyframes markIn {
      from { opacity: 0; transform: scale(0.7); }
      to   { opacity: 1; transform: scale(1); }
    }

    /* Pulse glow on logo mark — runs after markIn */
    .logo-mark.pulse {
      animation:
        markIn 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.35s forwards,
        glow 1.8s ease-in-out 0.85s infinite;
    }

    @keyframes glow {
      0%,100% { box-shadow: 0 0 20px rgba(139,92,246,0.25), inset 0 1px 0 rgba(255,255,255,0.1); }
      50%      { box-shadow: 0 0 32px rgba(139,92,246,0.45), inset 0 1px 0 rgba(255,255,255,0.15); }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* ── Wordmark ── */
    .wordmark {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      opacity: 0;
      transform: translateY(6px);
      animation: wordIn 0.5s ease 0.65s forwards;
    }

    @keyframes wordIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .wordmark-name {
      font-size: 24px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.8px;
      /* Clip mask for character reveal effect */
      overflow: hidden;
      white-space: nowrap;
      width: 0;
      animation: typeIn 0.6s steps(10, end) 0.65s forwards;
    }

    @keyframes typeIn {
      from { width: 0; }
      to   { width: 160px; }
    }

    .wordmark-sub {
      font-size: 10px;
      font-weight: 500;
      color: rgba(255,255,255,0.3);
      letter-spacing: 3px;
      text-transform: uppercase;
      opacity: 0;
      animation: fadeIn 0.4s ease 1.2s forwards;
    }

    /* ── Progress bar ── */
    .progress-wrap {
      width: 140px;
      height: 1.5px;
      background: rgba(255,255,255,0.05);
      border-radius: 2px;
      overflow: hidden;
      opacity: 0;
      animation: fadeIn 0.3s ease 1.1s forwards;
    }

    .progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #8B5CF6, #06B6D4);
      border-radius: 2px;
      animation: load 1.4s cubic-bezier(0.4,0,0.2,1) 1.1s forwards;
    }

    @keyframes load {
      0%   { width: 0%; }
      50%  { width: 60%; }
      80%  { width: 85%; }
      100% { width: 100%; }
    }

    /* ── Version ── */
    .version {
      position: absolute;
      bottom: 14px;
      font-size: 10px;
      color: rgba(255,255,255,0.15);
      letter-spacing: 0.5px;
      opacity: 0;
      animation: fadeIn 0.3s ease 1.3s forwards;
    }

    /* ── Ambient light blobs ── */
    .ambient {
      position: absolute;
      border-radius: 50%;
      filter: blur(60px);
      pointer-events: none;
    }

    .ambient-1 {
      width: 200px;
      height: 200px;
      background: rgba(139,92,246,0.06);
      top: -60px;
      left: -40px;
    }

    .ambient-2 {
      width: 160px;
      height: 160px;
      background: rgba(6,182,212,0.04);
      bottom: -40px;
      right: -20px;
    }
  </style>
</head>
<body>
  <!-- Ambient glow blobs -->
  <div class="ambient ambient-1"></div>
  <div class="ambient ambient-2"></div>

  <!-- Orbit rings + center logo mark -->
  <div class="orbit-container">
    <div class="ring ring-1"></div>
    <div class="ring ring-2"></div>
    <div class="ring ring-3"></div>
    <div class="logo-mark pulse">
      <!--
        REPLACE THIS with your actual SVG logo mark.
        If you have assets/icon.png, use:
        <img src="../assets/icon.png" width="20" height="20" style="opacity:0.9">

        If you have an SVG, paste it inline here.
        The fallback ghost emoji is placeholder only.
      -->
      <span class="fallback">👻</span>
    </div>
  </div>

  <!-- Wordmark -->
  <div class="wordmark">
    <div class="wordmark-name">Spectre AI</div>
    <div class="wordmark-sub">Intelligence Infrastructure</div>
  </div>

  <!-- Progress bar -->
  <div class="progress-wrap">
    <div class="progress-fill"></div>
  </div>

  <!-- Version -->
  <div class="version">v1.0.0</div>

  <script>
    // Fade out splash when progress bar finishes
    // Electron main process destroys this window after main window is ready
    // This just makes the exit smooth visually
    setTimeout(() => {
      document.body.classList.add('fade-out');
    }, 2500);
  </script>
</body>
</html>
```

---

## STEP 7 — WEB APP INTEGRATION

The Spectre web app needs to know it's running in desktop mode.
Add this to the web app where appropriate:

```javascript
// utils/platform.js — add to web app
export const isDesktop = typeof window !== 'undefined' && !!window.spectre?.isDesktop;
export const platform  = typeof window !== 'undefined' ? window.spectre?.platform : null;

// Use in components:
// if (isDesktop) show custom titlebar
// if (isDesktop) use window.spectre.notify() for breaking news instead of browser notification
// if (isDesktop) show "Spectre Lens" as coming soon in sidebar
```

**Custom titlebar for Mac (only shown in desktop app):**

Add to the root layout component — only renders when `isDesktop` is true:

```jsx
// Only show in desktop app — hides when running in browser
{isDesktop && platform === 'darwin' && (
  <div className="titlebar">
    {/* Traffic lights are native — don't render custom ones on Mac */}
    {/* Just add drag region and app title */}
    <div className="titlebar-drag" />
    <span className="titlebar-title">Spectre AI</span>
  </div>
)}
```

```css
.titlebar {
  height: 38px;
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.titlebar-drag { flex: 1; height: 100%; }
.titlebar-title {
  font-size: 13px;
  color: rgba(255,255,255,0.4);
  font-weight: 500;
  pointer-events: none;
}
```

**Wire up global hotkey for search:**
```javascript
// In your search component or root app
useEffect(() => {
  if (!window.spectre?.isDesktop) return;

  window.spectre.on('spectre:focus-search', () => {
    // Focus your search input
    document.querySelector('.search-input')?.focus();
  });
}, []);
```

**Wire up breaking news notifications:**
```javascript
// In your notification/breaking news handler
function sendBreakingNewsNotification(article) {
  if (window.spectre?.isDesktop) {
    // Use native desktop notification
    window.spectre.notify(article.headline, article.summary);
  } else {
    // Fall back to browser notification API
    new Notification(article.headline, { body: article.summary });
  }
}
```

---

## STEP 8 — INSTALL AND RUN

```bash
cd desktop
npm install

# Development (web app must be running on localhost first)
npm run dev

# Production build for Mac
npm run build:mac
```

---

## STEP 9 — VERIFY THESE THINGS WORK

Before calling it done, test every item:

- [ ] App launches with splash screen then transitions to main window
- [ ] No white flash on load (backgroundColor is set correctly)
- [ ] Tray icon appears in Mac menu bar
- [ ] Cmd+Shift+S opens app from anywhere on the system
- [ ] Closing window hides to tray — does NOT quit
- [ ] Quitting from tray menu actually quits
- [ ] External links open in default browser, not Electron
- [ ] Window size and position remembered between sessions
- [ ] Breaking news notification appears as native Mac notification
- [ ] Clicking notification focuses the app

---

## PHASE 2 — SPECTRE LENS (after desktop app is stable)

Once the desktop app is shipping, Lens gets added as a feature inside it.
See SPECTRE_ENTITY_RESOLUTION_UPGRADE.md for the Lens architecture.
The hotkey `Cmd+Shift+L` is already reserved in electron.js (commented out).
The tray menu already has "Spectre Lens" as a grayed-out coming soon item.

---

## IMPORTANT NOTES FOR CLAUDE CODE

1. Do NOT read large files whole. Use grep and offset/limit.
2. The desktop/ folder is new — it does not touch existing app files except
   to add the platform detection utility and titlebar component.
3. Check what port the dev server runs on before hardcoding DEV_URL.
4. If the app uses Next.js, the production load path differs from Vite —
   check and adjust accordingly.
5. Write a checkpoint file at /tmp/spectre-desktop-checkpoint.md if context
   fills before completion.
