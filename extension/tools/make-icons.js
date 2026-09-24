#!/usr/bin/env node
"use strict";
/**
 * Draw the extension icons.
 *
 *   node extension/tools/make-icons.js
 *
 * Writes icons/icon-16.png, 32, 48 and 128: the Dolluz mark as Kody wears it,
 * a gold K on the near black the bubble and the brand strip already use.
 *
 * Written by hand rather than pulled in from a library because four small PNGs
 * are not worth a dependency, and because the checked-in binaries should be
 * reproducible: run this again and you get the same bytes.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const INK = [0x11, 0x14, 0x17];      // #111417, the brand strip and the bubble
const GOLD = [0xc7, 0x9a, 0x18];     // #C79A18, Dolluz gold

/* ---------------- a very small PNG writer ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** RGBA, 8 bits per channel, no interlacing, filter 0 on every scanline. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 6;        // colour type: truecolour with alpha
  ihdr[10] = 0;       // deflate
  ihdr[11] = 0;       // adaptive filtering
  ihdr[12] = 0;       // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- drawing ---------------- */

/** Distance from a point to a line segment, for strokes with round ends. */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function insideRoundedSquare(x, y, size, radius) {
  const inner = size - radius;
  const cx = Math.min(Math.max(x, radius), inner);
  const cy = Math.min(Math.max(y, radius), inner);
  if (x >= radius && x <= inner) return y >= 0 && y <= size;
  if (y >= radius && y <= inner) return x >= 0 && x <= size;
  return Math.hypot(x - cx, y - cy) <= radius;
}

/**
 * The K: an upright stem, an arm going up and out, and a leg going down and
 * out, all struck from the same point so it reads at 16 pixels.
 */
function insideK(x, y, size, stroke) {
  const half = stroke / 2;
  const left = size * 0.32;
  const right = size * 0.72;
  const top = size * 0.26;
  const bottom = size * 0.74;
  const joint = size * 0.52;
  return (
    distanceToSegment(x, y, left, top, left, bottom) <= half ||
    distanceToSegment(x, y, left, joint, right, top) <= half ||
    distanceToSegment(x, y, left, joint, right, bottom) <= half
  );
}

/** 4x4 supersampling, which is enough to keep the 16px icon from looking chewed. */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const stroke = Math.max(1.6, size * 0.13);
  const samples = 4;
  const step = 1 / (samples + 1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let background = 0;
      let glyph = 0;
      for (let sy = 1; sy <= samples; sy++) {
        for (let sx = 1; sx <= samples; sx++) {
          const px = x + sx * step;
          const py = y + sy * step;
          if (insideRoundedSquare(px, py, size, radius)) background += 1;
          if (insideK(px, py, size, stroke)) glyph += 1;
        }
      }
      const total = samples * samples;
      const bgAlpha = background / total;
      const glyphAlpha = Math.min(glyph / total, bgAlpha);   // the K never spills past the tile

      const offset = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[offset + c] = Math.round(INK[c] * (1 - glyphAlpha) + GOLD[c] * glyphAlpha);
      }
      rgba[offset + 3] = Math.round(bgAlpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(outDir, `icon-${size}.png`);
  const png = drawIcon(size);
  fs.writeFileSync(file, png);
  console.log(`wrote ${path.relative(process.cwd(), file)}  ${png.length} bytes`);
}
