// Generates the PWA icons (a bold white "C" with a dashed cut line on a solid colour).
// Usage: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [0x0f, 0x76, 0x6e];
const FG = [0xff, 0xff, 0xff];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Coverage (0/1) of the motif at unit coords (u,v) in [-1,1]; motif radius 1 = safe area. */
function motif(u, v) {
  const r = Math.hypot(u, v);
  const ang = Math.atan2(v, u); // 0 = right
  // "C": ring with an opening towards the right (+-40 degrees)
  if (r >= 0.62 && r <= 1.0 && Math.abs(ang) > 0.7) return true;
  // dashed cut line through the opening (horizontal)
  if (Math.abs(v) < 0.06 && u > 0.1 && u < 1.0) return Math.floor((u - 0.1) / 0.18) % 2 === 0;
  return false;
}

function render(size, motifScale) {
  const rgb = Buffer.alloc(size * size * 3);
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (((x + (sx + 0.5) / SS) / size) * 2 - 1) / motifScale;
          const v = (((y + (sy + 0.5) / SS) / size) * 2 - 1) / motifScale;
          if (motif(u, v)) hits++;
        }
      }
      const a = hits / (SS * SS);
      for (let c = 0; c < 3; c++) rgb[(y * size + x) * 3 + c] = Math.round(BG[c] + (FG[c] - BG[c]) * a);
    }
  }
  return rgb;
}

mkdirSync('public/icons', { recursive: true });
// any-purpose icons: motif fills ~84% of the canvas; maskable: motif radius 70% of half-size, inside the 80% safe circle.
for (const [file, size, scale] of [
  ['icon-192.png', 192, 0.84],
  ['icon-512.png', 512, 0.84],
  ['icon-maskable-512.png', 512, 0.7],
]) {
  writeFileSync(`public/icons/${file}`, png(size, render(size, scale)));
  console.log('wrote', file);
}
