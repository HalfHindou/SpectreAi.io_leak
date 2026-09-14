#!/usr/bin/env node
/**
 * SPECTRE MOCKUP COMPOSITOR
 * 
 * Composites screenshots into device mockup frames.
 * Run: node spectre-mockup.js --url https://app.spectreai.io --template macbook-pro-front
 * Or:  node spectre-mockup.js --screenshot ./my-screen.png --template macbook-pro-front
 */

const sharp = require('sharp');
const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');

// ─── MOCKUP TEMPLATES ────────────────────────────────────────────
// Update these coordinates after you download your mockup PNGs.
// Screen coordinates = the exact pixel region where the display is.
// Use any image editor (or Figma MCP get_design_context) to measure.

const MOCKUP_TEMPLATES = {
  'macbook-pro-front': {
    file: 'mockups/macbook-pro-front.png',
    screen: { x: 290, y: 52, width: 1340, height: 838 },
    borderRadius: 12,
    outputWidth: 1920,
    outputHeight: 1280,
    perspective: null,
  },
  'macbook-pro-angle-left': {
    file: 'mockups/macbook-pro-angle-left.png',
    screen: { x: 218, y: 78, width: 1180, height: 738 },
    borderRadius: 8,
    outputWidth: 1920,
    outputHeight: 1280,
    perspective: {
      topLeft: [218, 78],
      topRight: [1398, 115],
      bottomRight: [1370, 816],
      bottomLeft: [246, 778],
    },
  },
  'macbook-pro-clay': {
    file: 'mockups/macbook-pro-clay.png',
    screen: { x: 290, y: 52, width: 1340, height: 838 },
    borderRadius: 12,
    outputWidth: 1920,
    outputHeight: 1280,
    perspective: null,
  },
  'iphone-15-pro': {
    file: 'mockups/iphone-15-pro.png',
    screen: { x: 56, y: 56, width: 393, height: 852 },
    borderRadius: 44,
    outputWidth: 506,
    outputHeight: 1024,
    perspective: null,
  },
};

// ─── COMPOSITING ENGINE ──────────────────────────────────────────

async function composeMockup({ mockupTemplate, screenshotPath, outputPath, options = {} }) {
  const template = typeof mockupTemplate === 'string'
    ? MOCKUP_TEMPLATES[mockupTemplate]
    : mockupTemplate;

  if (!template) {
    throw new Error(`Unknown template: ${mockupTemplate}. Available: ${Object.keys(MOCKUP_TEMPLATES).join(', ')}`);
  }

  if (!fs.existsSync(template.file)) {
    throw new Error(`Mockup file not found: ${template.file}\nDownload a MacBook Pro mockup PNG and place it there.`);
  }

  const { screen, borderRadius, outputWidth, outputHeight } = template;

  // Load mockup frame
  const mockupBuffer = fs.readFileSync(template.file);

  // Resize screenshot to fit screen area
  let screenshotBuffer = await sharp(screenshotPath)
    .resize(screen.width, screen.height, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  // Round corners to match display
  if (borderRadius > 0) {
    const roundedMask = Buffer.from(
      `<svg width="${screen.width}" height="${screen.height}">
        <rect x="0" y="0" width="${screen.width}" height="${screen.height}" 
              rx="${borderRadius}" ry="${borderRadius}" fill="white"/>
      </svg>`
    );
    screenshotBuffer = await sharp(screenshotBuffer)
      .composite([{
        input: await sharp(roundedMask)
          .resize(screen.width, screen.height)
          .png()
          .toBuffer(),
        blend: 'dest-in',
      }])
      .png()
      .toBuffer();
  }

  // Build composite layers
  const compositeOps = [];

  // Layer 1: Screenshot positioned in screen area
  compositeOps.push({
    input: screenshotBuffer,
    top: screen.y,
    left: screen.x,
  });

  // Layer 2: Optional reflection
  if (options.reflection !== false) {
    const reflectionSvg = Buffer.from(`
      <svg width="${screen.width}" height="${screen.height}">
        <defs>
          <linearGradient id="refl" x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stop-color="white" stop-opacity="0.05"/>
            <stop offset="50%" stop-color="white" stop-opacity="0.02"/>
            <stop offset="100%" stop-color="white" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect width="${screen.width}" height="${screen.height}" fill="url(#refl)"/>
      </svg>
    `);
    compositeOps.push({
      input: await sharp(reflectionSvg).png().toBuffer(),
      top: screen.y,
      left: screen.x,
    });
  }

  // Layer 3: Mockup frame on top (bezel covers screenshot edges)
  compositeOps.push({
    input: mockupBuffer,
    top: 0,
    left: 0,
  });

  // Create transparent base canvas and composite everything
  const base = await sharp({
    create: {
      width: outputWidth,
      height: outputHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await sharp(base)
    .composite(compositeOps)
    .png({ quality: options.quality || 95 })
    .toFile(outputPath);

  console.log(`✓ Mockup saved: ${outputPath} (${result.width}x${result.height})`);
  return outputPath;
}

// ─── SCREENSHOT CAPTURE ──────────────────────────────────────────

async function captureScreen(url, outputPath, options = {}) {
  const puppeteer = require('puppeteer');
  const { width = 1440, height = 900, waitMs = 3000, darkMode = true } = options;

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });

  if (darkMode) {
    await page.emulateMediaFeatures([
      { name: 'prefers-color-scheme', value: 'dark' },
    ]);
  }

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, waitMs));

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await page.screenshot({ path: outputPath, type: 'png' });
  await browser.close();

  console.log(`✓ Screenshot captured: ${outputPath}`);
  return outputPath;
}

// ─── CLI ─────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    flags[args[i].replace('--', '')] = args[i + 1];
  }

  const template = flags.template || 'macbook-pro-front';
  const output = flags.output || `ads/spectre-${template}-${Date.now()}.png`;

  let screenshotPath = flags.screenshot;

  // If URL provided, capture screenshot first
  if (flags.url) {
    screenshotPath = `screenshots/capture-${Date.now()}.png`;
    await captureScreen(flags.url, screenshotPath);
  }

  if (!screenshotPath) {
    console.log(`
SPECTRE MOCKUP COMPOSITOR
─────────────────────────
Usage:
  node spectre-mockup.js --url https://app.spectreai.io --template macbook-pro-front
  node spectre-mockup.js --screenshot ./screen.png --template macbook-pro-front --output ./ad.png

Templates: ${Object.keys(MOCKUP_TEMPLATES).join(', ')}
    `);
    return;
  }

  await composeMockup({
    mockupTemplate: template,
    screenshotPath,
    outputPath: output,
    options: { reflection: true },
  });
}

main().catch(console.error);

module.exports = { composeMockup, captureScreen, MOCKUP_TEMPLATES };
