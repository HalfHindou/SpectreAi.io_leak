# SPECTRE MOCKUP COMPOSITING SKILL

> Turn any Spectre screenshot into a professional MacBook Pro advertisement in seconds.

---

## THE PROBLEM

Figma MCP is read-only — it can pull screenshots and metadata, but it can't place images into mockup frames. So we handle compositing in code.

---

## ARCHITECTURE

```
┌─────────────────────────────────────────────────────────┐
│                   MOCKUP PIPELINE                        │
│                                                          │
│  1. MOCKUP TEMPLATES (PNG)                              │
│     └── MacBook Pro frames with transparent screens     │
│     └── Screen coordinates pre-mapped per template      │
│                                                          │
│  2. SCREEN CONTENT (PNG/JPG)                            │
│     └── App screenshots (Puppeteer capture OR manual)   │
│     └── Figma exports (via Figma MCP get_screenshot)    │
│                                                          │
│  3. COMPOSITING ENGINE (Sharp + Canvas)                 │
│     └── Resize screenshot to screen dimensions          │
│     └── Apply perspective transform (if angled mockup)  │
│     └── Composite onto mockup template                  │
│     └── Add optional shadow/glow/reflection             │
│                                                          │
│  4. OUTPUT                                              │
│     └── Final ad-ready PNG/JPG at target resolution     │
│     └── Multiple variants if batch mode                 │
└─────────────────────────────────────────────────────────┘
```

---

## SETUP (run once)

```bash
npm install sharp canvas puppeteer-core
# or if puppeteer full:
npm install sharp canvas puppeteer
```

---

## MOCKUP TEMPLATE FORMAT

Each mockup template is a config object:

```js
const MOCKUP_TEMPLATES = {
  'macbook-pro-front': {
    // The mockup image (MacBook Pro with transparent/solid screen)
    file: 'mockups/macbook-pro-front.png',
    // Screen region coordinates (top-left x,y → width,height)
    screen: { x: 290, y: 52, width: 1340, height: 838 },
    // Screen corner radius (for rounded display corners)
    borderRadius: 12,
    // Output dimensions of the full mockup
    outputWidth: 1920,
    outputHeight: 1280,
    // Optional perspective transform (null = flat front-facing)
    perspective: null,
  },
  'macbook-pro-angle-left': {
    file: 'mockups/macbook-pro-angle-left.png',
    screen: { x: 218, y: 78, width: 1180, height: 738 },
    borderRadius: 8,
    outputWidth: 1920,
    outputHeight: 1280,
    // Perspective: 4-corner mapping for angled views
    perspective: {
      topLeft: [218, 78],
      topRight: [1398, 115],
      bottomRight: [1370, 816],
      bottomLeft: [246, 778],
    },
  },
  'macbook-pro-clay-white': {
    file: 'mockups/macbook-pro-clay-white.png',
    screen: { x: 290, y: 52, width: 1340, height: 838 },
    borderRadius: 12,
    outputWidth: 1920,
    outputHeight: 1280,
    perspective: null,
  },
};
```

---

## CORE COMPOSITING SCRIPT

```js
// composeMockup.js
const sharp = require('sharp');
const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');

async function composeMockup({
  mockupTemplate,   // key from MOCKUP_TEMPLATES or full config
  screenshotPath,   // path to the screenshot to insert
  outputPath,       // where to save the final image
  options = {},     // { reflection: false, glow: false, quality: 95 }
}) {
  const template = typeof mockupTemplate === 'string'
    ? MOCKUP_TEMPLATES[mockupTemplate]
    : mockupTemplate;

  if (!template) throw new Error(`Unknown mockup template: ${mockupTemplate}`);

  const { screen, borderRadius, outputWidth, outputHeight } = template;

  // 1. Load the mockup frame
  const mockupBuffer = fs.readFileSync(template.file);

  // 2. Load and resize the screenshot to fit the screen area
  let screenshotBuffer = await sharp(screenshotPath)
    .resize(screen.width, screen.height, { fit: 'cover', position: 'top' })
    .png()
    .toBuffer();

  // 3. Round the screenshot corners to match display
  if (borderRadius > 0) {
    const roundedMask = Buffer.from(
      `<svg><rect x="0" y="0" width="${screen.width}" height="${screen.height}" rx="${borderRadius}" ry="${borderRadius}" fill="white"/></svg>`
    );
    screenshotBuffer = await sharp(screenshotBuffer)
      .composite([{
        input: await sharp(roundedMask).resize(screen.width, screen.height).png().toBuffer(),
        blend: 'dest-in',
      }])
      .png()
      .toBuffer();
  }

  // 4. If perspective transform needed (angled mockup), use canvas
  if (template.perspective) {
    screenshotBuffer = await applyPerspective(
      screenshotBuffer,
      screen,
      template.perspective,
      outputWidth,
      outputHeight
    );
  }

  // 5. Composite screenshot onto mockup
  const compositeOps = [
    {
      input: screenshotBuffer,
      top: template.perspective ? 0 : screen.y,
      left: template.perspective ? 0 : screen.x,
    },
  ];

  // 6. Add screen reflection overlay (optional)
  if (options.reflection) {
    const reflectionOverlay = createReflectionOverlay(screen);
    compositeOps.push({
      input: reflectionOverlay,
      top: screen.y,
      left: screen.x,
      blend: 'screen',
    });
  }

  // 7. Layer: mockup frame ON TOP (so bezel covers screenshot edges)
  compositeOps.push({
    input: mockupBuffer,
    top: 0,
    left: 0,
  });

  // 8. Build final image
  const base = await sharp({
    create: {
      width: outputWidth,
      height: outputHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();

  const result = await sharp(base)
    .composite(compositeOps)
    .png({ quality: options.quality || 95 })
    .toFile(outputPath);

  console.log(`Mockup saved: ${outputPath} (${result.width}x${result.height})`);
  return outputPath;
}

// Perspective transform using canvas 2D
async function applyPerspective(imgBuffer, screen, corners, outW, outH) {
  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  const img = await loadImage(imgBuffer);

  // Use canvas path clipping + drawImage with transform
  // For proper perspective, subdivide into triangles
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.topLeft[0], corners.topLeft[1]);
  ctx.lineTo(corners.topRight[0], corners.topRight[1]);
  ctx.lineTo(corners.bottomRight[0], corners.bottomRight[1]);
  ctx.lineTo(corners.bottomLeft[0], corners.bottomLeft[1]);
  ctx.closePath();
  ctx.clip();

  // Approximate with affine transform (good enough for slight angles)
  const dx = corners.topRight[0] - corners.topLeft[0];
  const dy = corners.topRight[1] - corners.topLeft[1];
  const sx = Math.sqrt(dx * dx + dy * dy) / screen.width;
  const angle = Math.atan2(dy, dx);

  ctx.translate(corners.topLeft[0], corners.topLeft[1]);
  ctx.rotate(angle);
  ctx.scale(sx, sx);
  ctx.drawImage(img, 0, 0, screen.width, screen.height);
  ctx.restore();

  return canvas.toBuffer('image/png');
}

// Subtle screen reflection gradient
function createReflectionOverlay(screen) {
  const svg = `
    <svg width="${screen.width}" height="${screen.height}">
      <defs>
        <linearGradient id="refl" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="white" stop-opacity="0.06"/>
          <stop offset="40%" stop-color="white" stop-opacity="0.02"/>
          <stop offset="100%" stop-color="white" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="${screen.width}" height="${screen.height}" fill="url(#refl)"/>
    </svg>
  `;
  return Buffer.from(svg);
}

module.exports = { composeMockup, MOCKUP_TEMPLATES };
```

---

## GETTING REAL MACBOOK PRO MOCKUPS

Claude Code can't browse Figma Community. Here are the practical sources:

### Option 1: Figma Export (if you have a mockup in your Figma file)
```
Use Figma MCP to:
1. get_metadata on your mockup file page → find the MacBook frame node ID
2. get_screenshot of that node → download the PNG
3. Map the screen coordinates manually (or ask Claude to estimate from the screenshot)
```

### Option 2: Free Mockup PNGs (download once, reuse forever)
```
Sources for transparent-screen MacBook Pro mockups:
- https://www.ls.graphics/free-mockups (high quality, free)
- https://mockupworld.co/free/category/apple/ (curated collection)  
- https://www.anthonyboyd.graphics/mockups (premium free)
- Search "MacBook Pro mockup transparent screen PNG" on Google Images

Save to: mockups/ directory in your project
Then map the screen coordinates in MOCKUP_TEMPLATES config
```

### Option 3: Generate via HTML/CSS (fully automated, no external files)
```js
// Generate a minimal MacBook Pro frame in code
// This gives you a clean front-facing mockup without needing any PNGs
// See the AUTOMATED MOCKUP GENERATOR section below
```

---

## AUTOMATED MOCKUP GENERATOR (no external files needed)

If you don't have a mockup PNG, generate one with Puppeteer:

```js
// generateMockupFrame.js
const puppeteer = require('puppeteer');

async function generateMacBookFrame(outputPath, options = {}) {
  const { width = 1920, height = 1280, color = 'space-gray' } = options;

  const colors = {
    'space-gray': { body: '#2d2d2d', bezel: '#1a1a1a', hinge: '#4a4a4a' },
    'silver': { body: '#c0c0c0', bezel: '#2a2a2a', hinge: '#d0d0d0' },
  };
  const c = colors[color] || colors['space-gray'];

  const html = `
    <html>
    <body style="margin:0; background:transparent; display:flex; justify-content:center; align-items:center; width:${width}px; height:${height}px;">
      <div style="position:relative;">
        <!-- Screen bezel -->
        <div style="
          width: 1340px; height: 870px;
          background: ${c.bezel};
          border-radius: 16px 16px 0 0;
          padding: 16px 16px 0 16px;
          box-shadow: 0 0 0 2px rgba(255,255,255,0.1);
        ">
          <!-- Screen (transparent hole) -->
          <div id="screen" style="
            width: 1308px; height: 838px;
            background: transparent;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.05);
          "></div>
        </div>
        <!-- Base/hinge -->
        <div style="
          width: 1500px; height: 14px;
          background: linear-gradient(180deg, ${c.hinge}, ${c.body});
          border-radius: 0 0 8px 8px;
          margin: 0 auto;
          position: relative;
          left: -80px;
        "></div>
        <!-- Bottom base -->
        <div style="
          width: 1520px; height: 8px;
          background: ${c.body};
          border-radius: 0 0 12px 12px;
          margin: 0 auto;
          position: relative;
          left: -90px;
        "></div>
      </div>
    </body>
    </html>
  `;

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.screenshot({ path: outputPath, omitBackground: true });
  await browser.close();

  return {
    file: outputPath,
    screen: { x: 306, y: 68, width: 1308, height: 838 },
    borderRadius: 8,
    outputWidth: width,
    outputHeight: height,
  };
}

module.exports = { generateMacBookFrame };
```

---

## CAPTURING SPECTRE APP SCREENSHOTS

```js
// captureSpectre.js
const puppeteer = require('puppeteer');

async function captureSpectreScreen(url, outputPath, options = {}) {
  const {
    width = 1440,
    height = 900,
    waitFor = 3000,       // wait for animations to settle
    selector = null,      // optional: capture specific element
    darkMode = true,
  } = options;

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
  await page.waitForTimeout(waitFor);

  const screenshotOptions = { path: outputPath, type: 'png' };
  if (selector) {
    const el = await page.$(selector);
    if (el) await el.screenshot(screenshotOptions);
  } else {
    await page.screenshot(screenshotOptions);
  }

  await browser.close();
  return outputPath;
}

module.exports = { captureSpectreScreen };
```

---

## FULL PIPELINE USAGE

```js
const { composeMockup } = require('./composeMockup');
const { captureSpectreScreen } = require('./captureSpectre');

async function generateAd() {
  // 1. Capture the Spectre War Room
  await captureSpectreScreen(
    'https://app.spectreai.io/command-center',
    'screenshots/warroom.png',
    { width: 1440, height: 900 }
  );

  // 2. Compose into MacBook Pro mockup
  await composeMockup({
    mockupTemplate: 'macbook-pro-front',
    screenshotPath: 'screenshots/warroom.png',
    outputPath: 'ads/spectre-warroom-macbook.png',
    options: { reflection: true },
  });

  // 3. Batch: multiple screens into multiple mockups
  const screens = [
    { url: 'https://app.spectreai.io', name: 'dashboard' },
    { url: 'https://app.spectreai.io/command-center', name: 'warroom' },
    { url: 'https://spectreai.io', name: 'landing' },
  ];

  for (const screen of screens) {
    await captureSpectreScreen(screen.url, `screenshots/${screen.name}.png`);
    await composeMockup({
      mockupTemplate: 'macbook-pro-front',
      screenshotPath: `screenshots/${screen.name}.png`,
      outputPath: `ads/spectre-${screen.name}-macbook.png`,
      options: { reflection: true },
    });
  }
}

generateAd();
```

---

## FIGMA MCP INTEGRATION (reading mockup coordinates from Figma)

If you have a MacBook Pro mockup in Figma and want Claude Code to read it:

```
PROMPT TO CLAUDE CODE:
─────────────────────
I have a MacBook Pro mockup in this Figma file: [paste Figma URL]

1. Use Figma MCP get_metadata on the page to find all layer names
2. Use get_screenshot on the full mockup frame to export it as PNG
3. Use get_design_context on the screen placeholder layer to get its
   exact position (x, y, width, height) relative to the mockup frame
4. Save the mockup PNG to mockups/ directory
5. Create a MOCKUP_TEMPLATES entry with the extracted screen coordinates
6. Then use composeMockup() to place my Spectre screenshot into it
```

---

## OPENCLAW AGENT DEFINITION

```yaml
agent:
  name: spectre_ad_compositor
  department: creative
  role: "Mockup Compositor & Ad Generator"
  model: claude-sonnet  # needs vision for coordinate estimation
  
  description: >
    Takes Spectre app screenshots and composites them into 
    real device mockups (MacBook Pro, iPhone, iPad) for 
    advertisements, social posts, and marketing materials.
  
  triggers:
    - "generate ad"
    - "mockup"
    - "device frame"
    - "macbook screenshot"
    - "product shot"
  
  tools:
    - figma_mcp        # read mockup templates from Figma
    - sharp             # image processing
    - canvas            # perspective transforms
    - puppeteer         # screenshot capture + mockup generation
    - filesystem        # read/write images
  
  workflow:
    1_input: "Receive target URL or screenshot path + mockup style"
    2_capture: "If URL given, capture screenshot via Puppeteer"
    3_template: "Load mockup template (PNG + screen coordinates)"
    4_composite: "Resize, round corners, composite into frame"
    5_enhance: "Add reflection, shadow, glow if requested"
    6_output: "Save final ad image, report path"
  
  constraints:
    - Output must be minimum 2x resolution (retina)
    - No watermarks from free mockup sources
    - Spectre branding visible in every output
    - Match SPECTRE_DESIGN_LAW aesthetic (dark, premium, not crypto-bro)
```

---

## CLAUDE CODE MASTER PROMPT

Copy this entire block and paste it into Claude Code when you want to generate ads:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPECTRE AD MOCKUP GENERATOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TASK: Generate professional MacBook Pro advertisement images 
featuring the Spectre AI platform.

CONTEXT:
- Figma MCP is connected (use it to READ mockup files if I provide a Figma URL)
- Figma MCP is READ-ONLY — it cannot edit or place images in Figma
- All compositing happens in code via Sharp + Canvas
- Output must look Apple-level premium, not "AI slop"

WHAT I NEED YOU TO DO:

1. CHECK FOR MOCKUP TEMPLATES
   - Look in mockups/ directory for existing MacBook Pro PNGs
   - If none exist, generate one using Puppeteer (HTML-rendered MacBook frame)
   - If I provide a Figma URL, use Figma MCP to:
     a) get_metadata → find the mockup layers
     b) get_screenshot → export the frame as PNG  
     c) get_design_context → get screen coordinates
     d) Save to mockups/ with a MOCKUP_TEMPLATES config entry

2. CAPTURE SPECTRE SCREENSHOTS (if needed)
   - Target URLs: app.spectreai.io, spectreai.io, or specific pages I specify
   - Use Puppeteer with: viewport 1440x900, deviceScaleFactor 2, dark mode
   - Wait 3s for animations to settle before capture
   - Save to screenshots/ directory

3. COMPOSITE
   - Resize screenshot to match screen area dimensions
   - Round corners to match MacBook display radius
   - Apply perspective transform if using angled mockup
   - Layer: transparent base → screenshot → mockup frame on top
   - Optional: add subtle screen reflection overlay (linear gradient, 6% opacity max)

4. OUTPUT
   - Save to ads/ directory as PNG
   - Filename format: spectre-{page}-{mockup-style}-{timestamp}.png
   - Minimum 1920px wide for social/web use
   - Also generate a 1080x1080 cropped version for Instagram

5. BATCH MODE (if I say "all screens")
   - Dashboard (app.spectreai.io)
   - Command Center / War Room
   - Intelligence Hub / Edition
   - Token Deep Dive (pick BTC or ETH)
   - Landing page (spectreai.io)
   - Generate each in every available mockup template

DEPENDENCIES: sharp, canvas, puppeteer
INSTALL: npm install sharp canvas puppeteer --save-dev

DO NOT:
- Use placeholder/dummy screenshots
- Add fake UI elements not in the real app
- Use low-res mockups (minimum 2x/retina)
- Output anything that looks like a Fiverr mockup template
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## ADDING MORE DEVICE TYPES

Same pattern works for iPhone, iPad, etc. Just change the template config:

```js
'iphone-15-pro': {
  file: 'mockups/iphone-15-pro.png',
  screen: { x: 56, y: 56, width: 393, height: 852 },
  borderRadius: 44,
  outputWidth: 506,
  outputHeight: 1024,
  perspective: null,
},
'ipad-pro': {
  file: 'mockups/ipad-pro.png',
  screen: { x: 48, y: 48, width: 1024, height: 1366 },
  borderRadius: 18,
  outputWidth: 1120,
  outputHeight: 1462,
  perspective: null,
},
```
