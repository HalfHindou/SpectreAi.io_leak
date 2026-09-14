'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Map original callbacks to wrappers so off() can remove the correct listener
const _listenerMap = new Map();

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

  // Send messages to main process (Lens overlay uses this)
  send: (channel, data) => {
    const allowed = [
      // Core Lens channels
      'lens:dismiss',
      'lens:stop-listening',
      'lens:start-listening',
      'lens:text-query',
      'lens:toggle-voice',
      'lens:open-deep-dive',
      'lens:audio-data',
      'lens:retry',
      // v3 channels
      'lens:resize',
      'lens:passive-activate',
      'lens:conversation',
      'lens:conversation-voice',
      'lens:history-load',
      'lens:history-save',
      'lens:open-url',
      'lens:pin-watchlist',
      'lens:scan-screen',
      // v3 TradingView + alerts
      'lens:tv-detected',
      'lens:tv-command',
      'lens:set-alert',
    ];
    if (allowed.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // Listen for main process events
  on: (channel, callback) => {
    const allowed = [
      // App-level
      'spectre:focus-search',
      'spectre:open-settings',
      'spectre:open-notifications',
      'spectre:navigate-token',
      // Core Lens channels
      'lens:state',
      'lens:reset',
      'lens:context',
      'lens:result',
      'lens:query',
      'lens:audio',
      'lens:start-mic',
      'lens:stop-mic',
      // v3 channels
      'lens:error',
      'lens:passive-detect',
      'lens:screenshot',
      'lens:conversation-reply',
      'lens:conversation-transcription',
      'lens:history-data',
      // v3 TradingView + alerts
      'lens:tv-mode',
      'lens:tv-result',
      'lens:alert-set',
    ];
    if (allowed.includes(channel)) {
      const wrapper = (_, data) => callback(data);
      _listenerMap.set(callback, wrapper);
      ipcRenderer.on(channel, wrapper);
    }
  },

  // Remove listener (uses stored wrapper so it actually removes the correct reference)
  off: (channel, callback) => {
    const wrapper = _listenerMap.get(callback);
    if (wrapper) {
      ipcRenderer.removeListener(channel, wrapper);
      _listenerMap.delete(callback);
    }
  },
});
