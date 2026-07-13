// Find unprocessed Cox HPT transcripts on this machine.
// Usage: node scripts/find-transcript.mjs [extra dirs...]
// Scans %USERPROFILE%\Downloads (plus any extra dirs) for Cox HPT *.docx files,
// reads each file's INTERNAL meeting date (the "Cox HPT-YYYYMMDD_..." header —
// not file metadata), and prints JSON of those newer than the last meeting in
// data/data.json (all of them if data.json is missing). Oldest first, deduped
// by meeting date (newest file wins).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { readZip, decodeXmlEntities } from './zip-util.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function meetingDateOf(file) {
  try {
    const zip = readZip(readFileSync(file));
    const xml = zip.get('word/document.xml').toString('utf8');
    // Only need the head of the document for the header line.
    const headText = decodeXmlEntities(
      xml.slice(0, 20000).replace(/<[^>]+>/g, ' ')
    );
    const m = headText.match(/Cox\s*HPT-(\d{4})(\d{2})(\d{2})_/i);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  } catch {
    return null;
  }
}

let lastProcessed = '0000-00-00';
const dataPath = join(root, 'data', 'data.json');
if (existsSync(dataPath)) {
  try {
    const data = JSON.parse(readFileSync(dataPath, 'utf8'));
    for (const mtg of data.meetings ?? []) {
      if (mtg.date > lastProcessed) lastProcessed = mtg.date;
    }
  } catch { /* fall through — report everything */ }
}

const dirs = [join(homedir(), 'Downloads'), ...process.argv.slice(2)];
const byDate = new Map(); // meetingDate -> { path, mtime }
for (const dir of dirs) {
  let names = [];
  try { names = readdirSync(dir); } catch { continue; }
  for (const name of names) {
    if (!/cox.?hpt.*\.docx$/i.test(name) || name.startsWith('~$')) continue;
    const path = join(dir, name);
    const date = meetingDateOf(path);
    if (!date || date <= lastProcessed) continue;
    const mtime = statSync(path).mtimeMs;
    const cur = byDate.get(date);
    if (!cur || mtime > cur.mtime) byDate.set(date, { path, mtime });
  }
}

const found = [...byDate.entries()]
  .map(([meetingDate, { path }]) => ({ meetingDate, path }))
  .sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));

console.log(JSON.stringify({ lastProcessed, found }, null, 2));
