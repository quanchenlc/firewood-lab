/**
 * Longitudinal face-grain PNG for vertical chop faces (not end-grain rings).
 * Vertical lines + soft noise — reads as split wood, not a bullseye target.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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
export function writeFaceGrain(dest, rgb) {
  const size = 512;
  const [br, bg, bb] = rgb;
  const raw = Buffer.alloc(size * size * 3 + size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      // Soft vertical grain bands (along Y in UV → along log height when mapped)
      const band =
        Math.sin(x * 0.085) * 0.1 +
        Math.sin(x * 0.23 + 1.7) * 0.06 +
        Math.sin(x * 0.51 + y * 0.01) * 0.04;
      const pore = Math.sin(x * 0.9 + y * 0.35) * Math.sin(y * 0.12) * 0.03;
      const shade = 0.78 + band + pore;
      raw[o++] = Math.min(255, Math.max(0, br * shade));
      raw[o++] = Math.min(255, Math.max(0, bg * shade));
      raw[o++] = Math.min(255, Math.max(0, bb * shade));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const out = dest.replace(/\.jpe?g$/i, '.png');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
}
