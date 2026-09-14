'use strict';

// Load .env from monorepo root before anything else
const _dotenvResult = require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
// Force-apply all parsed values (dotenv.config can skip some)
if (_dotenvResult.parsed) {
  Object.entries(_dotenvResult.parsed).forEach(([k, v]) => {
    if (!process.env[k]) process.env[k] = v;
  });
}

// Guard against EPIPE crashes when terminal pipe breaks (macOS CLI launch)
process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});

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
} = require('electron');
const path  = require('path');
const http  = require('http');
const fs    = require('fs');
const Store = require('electron-store');
const { initLens, triggerLens, startPassiveDetection } = require('./lens/lens-main');

// ─── Config ─────────────────────────────────────────────────────
const isDev   = process.env.SPECTRE_DEV === 'true';
const DEV_URL = 'http://localhost:5180';
const store   = new Store();

// Set app name so menu bar shows "Spectre AI" (even in dev mode)
app.setName('Spectre AI');

// ─── MIME types for local static server ─────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
};

// ─── State ──────────────────────────────────────────────────────
let mainWindow   = null;
let tray         = null;
let splashWindow = null;
let localServer  = null;
let localPort    = 0;

// ─── Local Static Server (production only) ──────────────────────
function startLocalServer(distPath) {
  return new Promise((resolve) => {
    localServer = http.createServer((req, res) => {
      // Strip query string / hash
      let urlPath = (req.url || '/').split('?')[0].split('#')[0];
      // Decode URI components
      urlPath = decodeURIComponent(urlPath);
      // Map to file
      let filePath = path.join(distPath, urlPath);

      // SPA fallback: if no extension → serve index.html
      const ext = path.extname(filePath);
      if (!ext) {
        filePath = path.join(distPath, 'index.html');
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // Try index.html for SPA routes
          fs.readFile(path.join(distPath, 'index.html'), (err2, html) => {
            if (err2) {
              res.writeHead(404);
              res.end('Not found');
              return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
          });
          return;
        }
        const mime = MIME[path.extname(filePath)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
      });
    });

    // Listen on random available port on localhost only
    localServer.listen(0, '127.0.0.1', () => {
      localPort = localServer.address().port;
      console.log(`Spectre local server: http://127.0.0.1:${localPort}`);
      resolve(localPort);
    });
  });
}

// ─── App Ready ──────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Mac: set dock icon to Spectre logo
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
  }

  // Start local server for production builds
  if (!isDev) {
    // When packaged, dist lives in resources/app. When running unpackaged
    // (electron .), fall back to the monorepo's research dist directory.
    const packagedDist = path.join(process.resourcesPath, 'app');
    const monorepoDist = path.join(__dirname, '..', 'apps', 'research', 'dist');
    const distPath = fs.existsSync(path.join(packagedDist, 'index.html'))
      ? packagedDist
      : monorepoDist;
    await startLocalServer(distPath);
  }

  // Set Mac application menu so menu bar says "Spectre AI" instead of "Electron"
  if (process.platform === 'darwin') {
    const appMenu = Menu.buildFromTemplate([
      {
        label: 'Spectre AI',
        submenu: [
          { role: 'about', label: 'About Spectre AI' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide', label: 'Hide Spectre AI' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          {
            label: 'Quit Spectre AI',
            accelerator: 'CmdOrCtrl+Q',
            click: () => { app.isQuitting = true; app.quit(); },
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' }, { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' }, { role: 'zoom' },
          { type: 'separator' }, { role: 'front' },
        ],
      },
    ]);
    Menu.setApplicationMenu(appMenu);
  }

  await createSplash();
  await createMainWindow();
  createTray();
  registerHotkeys();

  // Init Spectre Lens (floating overlay)
  await initLens();

  // Start passive detection (10s background scans) after a brief delay
  setTimeout(() => startPassiveDetection(), 3000);

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
  const saved = store.get('windowBounds', {
    width: 1440, height: 900, x: undefined, y: undefined,
  });

  // Validate saved bounds are on a visible screen
  const { screen: electronScreen } = require('electron');
  const displays = electronScreen.getAllDisplays();
  const boundsVisible = saved.x !== undefined && displays.some(d => {
    const wa = d.workArea;
    return saved.x >= wa.x - 100 && saved.x < wa.x + wa.width &&
           saved.y >= wa.y - 100 && saved.y < wa.y + wa.height;
  });
  const bounds = boundsVisible ? saved : { width: 1440, height: 900 };

  mainWindow = new BrowserWindow({
    width:           bounds.width,
    height:          bounds.height,
    x:               bounds.x,
    y:               bounds.y,
    minWidth:        1024,
    minHeight:       700,
    titleBarStyle:   'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#09090b',
    show:            false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      true,
    },
  });

  // Dismiss splash — called once via ready-to-show or timeout
  let splashDismissed = false;
  function dismissSplash() {
    if (splashDismissed) return;
    splashDismissed = true;
    splashWindow?.destroy();
    splashWindow = null;
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
    mainWindow.setVisibleOnAllWorkspaces(false);
    if (store.get('isMaximized')) mainWindow.maximize();
  }

  // IMPORTANT: Attach ready-to-show BEFORE loadURL (it fires during load)
  mainWindow.once('ready-to-show', dismissSplash);

  // Safety net: always dismiss splash after 5s even if load fails
  setTimeout(dismissSplash, 5000);

  // Set optimal zoom for the display — the app was designed for ~1440px viewport.
  // On larger screens, scale down slightly so content isn't oversized.
  const primary = electronScreen.getPrimaryDisplay();
  const logicalWidth = primary.workAreaSize.width;
  const optimalZoom = logicalWidth >= 1728 ? 0.9
                    : logicalWidth >= 1512 ? 0.95
                    : 1.0;

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(optimalZoom);
  });

  // Load the app
  if (isDev) {
    try {
      await mainWindow.loadURL(DEV_URL);
    } catch (err) {
      console.warn('[Spectre] Dev server not reachable, retrying...', err.message);
      await sleep(2000);
      try {
        await mainWindow.loadURL(DEV_URL);
      } catch (err2) {
        console.error('[Spectre] Dev server unavailable at', DEV_URL);
        mainWindow.loadURL(`data:text/html,<body style="background:#09090b;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px"><h2>Spectre AI</h2><p style="color:#888">Dev server not running at ${DEV_URL}</p><p style="color:#666;font-size:13px">Run <code style="color:#8B5CF6">npm run dev:research</code> first</p></body>`);
      }
    }
    // DevTools available via View > Toggle Developer Tools (Cmd+Option+I)
  } else {
    await mainWindow.loadURL(`http://127.0.0.1:${localPort}`);
  }

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

  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    const appOrigin = isDev ? DEV_URL : `http://127.0.0.1:${localPort}`;
    if (!navUrl.startsWith(appOrigin)) {
      event.preventDefault();
      shell.openExternal(navUrl);
    }
  });

  // Prevent full close — hide to tray instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
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
      label: 'Spectre Lens  \u2318\u21E7L',
      click: () => triggerLens(),
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
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow?.isVisible()) {
    mainWindow.hide();
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

  // Spectre Lens — floating intelligence overlay
  globalShortcut.register('CommandOrControl+Shift+L', () => triggerLens());
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
  // Shut down local server
  if (localServer) localServer.close();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
