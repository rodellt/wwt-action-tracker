// Minimal ZIP reader (no dependencies). Handles the subset of the ZIP format
// used by Office Open XML files (.docx / .xlsx / .xlsm): deflate or stored
// entries, no zip64.
import { inflateRawSync } from 'node:zlib';

export function readZip(buf) {
  // Locate End Of Central Directory record (signature PK\x05\x06), scanning
  // backwards past any trailing comment.
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (no EOCD record found)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt central directory');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const xlen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    entries.set(name, { method, csize, lho });
    off += 46 + nlen + xlen + clen;
  }
  return {
    names: [...entries.keys()],
    get(name) {
      const e = entries.get(name);
      if (!e) return null;
      // Local file header repeats name/extra lengths; data follows them.
      const nlen = buf.readUInt16LE(e.lho + 26);
      const xlen = buf.readUInt16LE(e.lho + 28);
      const start = e.lho + 30 + nlen + xlen;
      const data = buf.subarray(start, start + e.csize);
      return e.method === 0 ? Buffer.from(data) : inflateRawSync(data);
    },
  };
}

export function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
