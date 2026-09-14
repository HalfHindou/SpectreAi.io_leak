/**
 * Generate PNG icons for the Chrome extension
 * Creates Spectre diamond logo at all required sizes
 * Run: node generate-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128];
const OUTPUT_DIR = path.join(__dirname, 'assets', 'icons');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function createPNG(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const cornerR = size * 0.18;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded rect mask
      let inRect = true;
      const corners = [[cornerR, cornerR], [size - cornerR - 1, cornerR], [cornerR, size - cornerR - 1], [size - cornerR - 1, size - cornerR - 1]];
      for (const [crx, cry] of corners) {
        const inCornerX = (x < cornerR && crx < size / 2) || (x > size - cornerR - 1 && crx > size / 2);
        const inCornerY = (y < cornerR && cry < size / 2) || (y > size - cornerR - 1 && cry > size / 2);
        if (inCornerX && inCornerY) {
          const cdx = x - crx;
          const cdy = y - cry;
          if (Math.sqrt(cdx * cdx + cdy * cdy) > cornerR) {
            inRect = false;
          }
        }
      }

      if (!inRect) {
        pixels[idx] = 0; pixels[idx + 1] = 0; pixels[idx + 2] = 0; pixels[idx + 3] = 0;
        continue;
      }

      // Diamond: |x-cx| + |y-cy| <= r
      const dist = Math.abs(x - cx) + Math.abs(y - cy);

      if (dist <= r) {
        const intensity = 1 - (dist / r);
        const pR = Math.round(139 * intensity + 99 * (1 - intensity));
        const pG = Math.round(92 * intensity + 102 * (1 - intensity));
        const pB = Math.round(246 * intensity + 241 * (1 - intensity));
        const edgeDist = r - dist;
        const alpha = edgeDist < 1.5 ? Math.min(255, Math.round(edgeDist / 1.5 * 255)) : 255;
        pixels[idx] = pR; pixels[idx + 1] = pG; pixels[idx + 2] = pB; pixels[idx + 3] = alpha;
      } else {
        pixels[idx] = 12; pixels[idx + 1] = 12; pixels[idx + 2] = 14; pixels[idx + 3] = 255;
      }
    }
  }

  return encodePNG(size, size, pixels);
}

function encodePNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw scanlines with filter byte
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    raw[rowOffset] = 0; // No filter
    pixels.copy(raw, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  // Compress with zlib
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', compressed),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

for (const size of SIZES) {
  const png = createPNG(size);
  const outPath = path.join(OUTPUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated: icon-${size}.png (${png.length} bytes)`);
}

console.log('All icons generated!');
