// icon.svg와 같은 그림으로 PNG 아이콘을 만들어요 (안드로이드·아이폰 홈 화면용)
// 사용법: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GREEN = [0x2f, 0x6f, 0x4e];
const CREAM = [0xf6, 0xf5, 0xf1];
const GOLD = [0xf2, 0xc1, 0x4e];

// 512 기준 좌표에서 한 점의 색 (없으면 투명)
function colorAt(x, y, radius) {
  const r = radius;
  const cx = Math.min(Math.max(x, r), 512 - r);
  const cy = Math.min(Math.max(y, r), 512 - r);
  if (x < 0 || y < 0 || x > 512 || y > 512 || Math.hypot(x - cx, y - cy) > r) return null;
  const d = Math.hypot(x - 256, y - 256);
  if (d <= 26) return GOLD;
  if (Math.abs(d - 150) <= 14 || Math.abs(d - 80) <= 14) return CREAM;
  return GREEN;
}

// 한 픽셀을 4x4로 나눠 찍어서 가장자리를 부드럽게 해요
function draw(size, radius) {
  const N = 4;
  const k = 512 / size;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = colorAt((x + (sx + 0.5) / N) * k, (y + (sy + 0.5) / N) * k, radius);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (y * size + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = (a / (N * N)) * 255; }
    }
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 아주 작은 PNG 인코더 (RGBA 8비트, 필터 없음)
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8비트 RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['icon-192.png', 192, 112],
  ['icon-512.png', 512, 112],
  ['apple-touch-icon.png', 180, 0], // 아이폰은 모서리를 알아서 둥글게 깎아서 꽉 찬 사각형으로 만들어요
];
for (const [name, size, radius] of targets) {
  const file = png(size, draw(size, radius));
  writeFileSync(path.join(ROOT, name), file);
  console.log(`${name} (${size}x${size}, ${(file.length / 1024).toFixed(1)}KB)`);
}
