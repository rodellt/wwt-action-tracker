// Refresh data/data.enc.json from the team's distributed tracker file.
// Since v3 the OneDrive-synced HPT-Tracker.html IS the source of truth for
// data — its embedded envelope carries every update. Run this FIRST in any
// session that will edit tracker data, then scripts/sync.mjs to decrypt.
// Usage: node scripts/pull-dist.mjs ["<path to HPT-Tracker.html>"]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TEAM_FILE =
  'C:\\Users\\rodellt\\WWT\\Cox Communications Program Information - Action Tracker\\HPT-Tracker.html';

const src = process.argv[2] ?? DEFAULT_TEAM_FILE;
if (!existsSync(src)) {
  console.error(`Team tracker file not found: ${src}`);
  console.error('Pass the path explicitly, or check that the OneDrive folder is synced.');
  process.exit(1);
}

const html = readFileSync(src, 'utf8');
const m = html.match(/window\.__HPT_EMBEDDED = ([\s\S]*?);\s*window\.__HPT_BUILD/);
if (!m) {
  console.error('No embedded envelope found in that file — is it a built HPT-Tracker.html?');
  process.exit(1);
}
const envelope = JSON.parse(m[1]);

const outPath = join(root, 'data', 'data.enc.json');
if (existsSync(outPath)) {
  const local = JSON.parse(readFileSync(outPath, 'utf8'));
  if ((local.lastUpdated ?? '') > (envelope.lastUpdated ?? '')) {
    console.error(`KEPT local data.enc.json (${local.lastUpdated}) — it is NEWER than the team file's snapshot (${envelope.lastUpdated}).`);
    console.error('If you really want the team file to win, delete data/data.enc.json and rerun.');
    process.exit(0);
  }
}

writeFileSync(outPath, JSON.stringify(envelope, null, 2) + '\n');
console.log(`Pulled envelope (lastUpdated ${envelope.lastUpdated}) from ${src}`);
console.log(`  -> ${outPath}`);
