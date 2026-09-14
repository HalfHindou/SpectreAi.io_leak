'use strict';

const screenshot = require('screenshot-desktop');
const { screen } = require('electron');

async function captureScreen(overlayWin) {
  // Hide overlay before capture so it doesn't appear in the screenshot
  const wasVisible = overlayWin?.isVisible();
  if (wasVisible) {
    overlayWin.hide();
    await sleep(150); // wait for OS to composite
  }

  try {
    const cursor   = screen.getCursorScreenPoint();
    const display  = screen.getDisplayNearestPoint(cursor);
    const displays = await screenshot.listDisplays();

    // Match Electron display to screenshot-desktop index
    let idx = 0;
    displays.forEach((d, i) => {
      if (d.id === display.id) idx = i;
    });

    const buffer = await screenshot({ screen: idx, format: 'png' });
    return buffer.toString('base64');

  } finally {
    if (wasVisible) overlayWin?.showInactive();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
module.exports = { captureScreen };
