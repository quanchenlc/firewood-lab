/**
 * Minimal concentric-ring endgrain JPEG/PNG writer without native deps.
 * Writes a PNG (filter 0) using zlib — Three.js TextureLoader accepts PNG.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {string} dest @param {[number,number,number]} rgb */
export function createCanvas(dest, rgb) {
  const size = 512;
  const [br, bg, bb] = rgb;
  const raw = Buffer.alloc((size * size * 3) + size); // + filter bytes per row
  let o = 0;
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.sin(r * 0.35) * 0.5 + 0.5;
      const ray = Math.abs(Math.sin(Math.atan2(dy, dx) * 8)) * 0.12;
      const n = (Math.sin(x * 0.17 + y * 0.11) + 1) * 0.04;
      const shade = 0.55 + ring * 0.35 + ray + n;
      raw[o++] = Math.min(255, Math.max(0, br * shade));
      raw[o++] = Math.min(255, Math.max(0, bg * shade));
      raw[o++] = Math.min(255, Math.max(0, bb * shade));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  // Always write .png even if caller passed .jpg path
  const out = dest.replace(/\.jpe?g$/i, '.png');
  writeFileSync(out, png);
}
