// Generator ikon PWA bez zaleznosci graficznych: rysuje piksele i koduje PNG przez zlib.
// Uruchom: node gen-icons.js  (tworzy public/icons/icon-180/192/512.png)
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  // raw: kazda linia poprzedzona bajtem filtra 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const af = a / 255, ia = 1 - af;
    buf[i] = r * af + buf[i] * ia;
    buf[i + 1] = g * af + buf[i + 1] * ia;
    buf[i + 2] = b * af + buf[i + 2] * ia;
    buf[i + 3] = Math.max(buf[i + 3], a);
  };
  // tlo: pionowy gradient indygo -> fiolet
  for (let y = 0; y < size; y++) {
    const t = y / size;
    const r = Math.round(79 + (155 - 79) * t);
    const g = Math.round(70 + (92 - 70) * t);
    const b = Math.round(229 + (255 - 229) * t);
    for (let x = 0; x < size; x++) set(x, y, r, g, b, 255);
  }
  // biala "karta" - zaokraglony prostokat
  const cardW = size * 0.62, cardH = size * 0.44;
  const cx = (size - cardW) / 2, cy = (size - cardH) / 2 + size * 0.02;
  const rad = size * 0.06;
  const inRR = (x, y, X, Y, W, H, R) => {
    if (x < X || y < Y || x > X + W || y > Y + H) return false;
    const dx = Math.min(x - X, X + W - x), dy = Math.min(y - Y, Y + H - y);
    if (dx > R || dy > R) return true;
    return (R - dx) ** 2 + (R - dy) ** 2 <= R * R;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (inRR(x, y, cx, cy, cardW, cardH, rad)) set(x, y, 255, 255, 255, 255);
  // pasek magnetyczny
  const stripeY = cy + cardH * 0.18, stripeH = cardH * 0.16;
  for (let y = stripeY; y < stripeY + stripeH; y++)
    for (let x = cx; x < cx + cardW; x++) set(x | 0, y | 0, 79, 70, 229, 255);
  // moneta (zolte kolko) w prawym dolnym rogu karty
  const coinR = size * 0.085, coinX = cx + cardW * 0.74, coinY = cy + cardH * 0.66;
  for (let y = -coinR; y <= coinR; y++)
    for (let x = -coinR; x <= coinR; x++)
      if (x * x + y * y <= coinR * coinR) set((coinX + x) | 0, (coinY + y) | 0, 250, 204, 21, 255);
  return encodePNG(size, buf);
}

for (const s of [180, 192, 512]) {
  writeFileSync(join(OUT, `icon-${s}.png`), makeIcon(s));
  console.log(`icon-${s}.png OK`);
}
