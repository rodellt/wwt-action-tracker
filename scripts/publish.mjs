// Encrypt data/data.json -> data/data.enc.json (the file that gets committed).
// Passphrase source (first found wins): TRACKER_PASSPHRASE env var, .secrets/passphrase.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptEnvelope } from './crypto-utils.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function passphrase() {
  if (process.env.TRACKER_PASSPHRASE) return process.env.TRACKER_PASSPHRASE.trim();
  try {
    return readFileSync(join(root, '.secrets', 'passphrase.txt'), 'utf8').trim();
  } catch {
    console.error('No passphrase: set TRACKER_PASSPHRASE or create .secrets/passphrase.txt');
    process.exit(1);
  }
}

const dataPath = join(root, 'data', 'data.json');
const outPath = join(root, 'data', 'data.enc.json');

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
data.lastUpdated = new Date().toISOString();

// ---- retention pruning (runs on every publish) ----
// Local calendar date (America/Chicago on Tyler's machine; cloud runs at
// 14:15 UTC, which is the same calendar date in Chicago).
const now = new Date();
const localDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = localDate(now);
const cutoff14 = localDate(new Date(now.getTime() - 14 * 86400000));

function addBusinessDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00`);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return localDate(d);
}

// Meeting history: keep two weeks (but always at least the newest meeting).
data.meetings.sort((a, b) => b.date.localeCompare(a.date));
const dropMeetings = data.meetings.filter((m, idx) => idx > 0 && m.date < cutoff14);
data.meetings = data.meetings.filter((m, idx) => idx === 0 || m.date >= cutoff14);

// Checked-off items: gone two business days after completion.
const dropItems = data.actionItems.filter(i =>
  i.status === 'completed' && !(i.completed?.date && today <= addBusinessDays(i.completed.date, 2)));
data.actionItems = data.actionItems.filter(i => !dropItems.includes(i));

// appliedOps ledger: newest ~200 ids is plenty for device-side dedupe.
if (Array.isArray(data.appliedOps) && data.appliedOps.length > 200) {
  data.appliedOps = data.appliedOps.slice(-200);
}

// Nothing is ever truly lost: pruned content lands in data/archive.json (gitignored).
if (dropMeetings.length || dropItems.length) {
  const archivePath = join(root, 'data', 'archive.json');
  let archive = { meetings: [], actionItems: [] };
  try { archive = JSON.parse(readFileSync(archivePath, 'utf8')); } catch { /* fresh archive */ }
  archive.meetings.push(...dropMeetings);
  archive.actionItems.push(...dropItems);
  writeFileSync(archivePath, JSON.stringify(archive, null, 2) + '\n');
  console.log(`Pruned ${dropMeetings.length} meeting(s) older than ${cutoff14} and ${dropItems.length} completed item(s) past the 2-business-day window (archived to data/archive.json).`);
}

writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');

const envelope = await encryptEnvelope(data, passphrase());
writeFileSync(outPath, JSON.stringify(envelope, null, 2) + '\n');
console.log(`Encrypted ${dataPath}`);
console.log(`      -> ${outPath} (${envelope.ct.length} b64 chars, lastUpdated ${envelope.lastUpdated})`);
