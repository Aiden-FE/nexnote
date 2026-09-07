/* eslint-disable no-console */
/**
 * Generate placeholder icon assets into build/ (solid rounded color).
 * Real brand icons should replace these files; the script only guarantees
 * the build never blocks on missing icon assets.
 *
 * Node-only (zlib + manual PNG chunks) — no native image dependency.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'build');
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Solid-color PNG with a simple centered square motif. */
function makePng(size, { r, g, b }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const rows = [];
  const half = size / 2;
  const inner = size * 0.28;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - half);
      const dy = Math.abs(y - half);
      const inside = dx < inner && dy < inner;
      const o = 1 + x * 3;
      row[o] = inside ? Math.min(255, r + 60) : r;
      row[o + 1] = inside ? Math.min(255, g + 60) : g;
      row[o + 2] = inside ? Math.min(255, b + 60) : b;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

// NexNote placeholder: deep indigo square with lighter inner block
const color = { r: 49, g: 46, b: 129 };
const png512 = makePng(512, color);
const png256 = makePng(256, color);
writeFileSync(resolve(outDir, 'icon.png'), png512);
writeFileSync(resolve(outDir, 'linux-icon.png'), png256);
// Native containers embed PNG payloads: ICO supports PNG since Vista; ICNS `ic08` is 256px PNG.
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader[6] = 0;
icoHeader[7] = 0;
icoHeader[8] = 0;
icoHeader[9] = 0;
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png256.length, 14);
icoHeader.writeUInt32LE(22, 18);
writeFileSync(resolve(outDir, 'icon.ico'), Buffer.concat([icoHeader, png256]));
const icnsChunk = Buffer.concat([Buffer.from('ic08'), Buffer.alloc(4), png256]);
icnsChunk.writeUInt32BE(icnsChunk.length, 4);
const icns = Buffer.concat([Buffer.from('icns'), Buffer.alloc(4), icnsChunk]);
icns.writeUInt32BE(icns.length, 4);
writeFileSync(resolve(outDir, 'icon.icns'), icns);

const files = ['icon.png', 'linux-icon.png', 'icon.ico', 'icon.icns'];
for (const f of files) {
  console.log(`${f}: written ${resolve(outDir, f)}`);
}
console.log('placeholder icons generated (512px + 256px PNG)');
