// Rotate the team passphrase in one pass.
//   node scripts/rotate-passphrase.mjs <new-passphrase>
//
// Updates .secrets/passphrase.txt and re-encrypts the tracker data. Afterwards
// rebuild and ship the file (build-html.mjs → copy to the team folder), update
// the passphrase line in the cloud routine's instructions
// (claude.ai/code/routines), and tell the team — everyone re-enters it once.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptEnvelope } from './crypto-utils.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const secretsPath = join(root, '.secrets', 'passphrase.txt');

const newPass = (process.argv[2] ?? '').trim();
if (!newPass) {
  console.error('Usage: node scripts/rotate-passphrase.mjs <new-passphrase>');
  process.exit(1);
}
const oldPass = readFileSync(secretsPath, 'utf8').trim();
if (newPass === oldPass) {
  console.error('That is already the current passphrase — nothing to do.');
  process.exit(1);
}

// 1. Swap the local secret.
writeFileSync(secretsPath, newPass + '\n');
console.log('.secrets/passphrase.txt updated.');

// 2. Re-encrypt the tracker data (data/data.json must be current — run sync first).
const data = JSON.parse(readFileSync(join(root, 'data', 'data.json'), 'utf8'));
writeFileSync(join(root, 'data', 'data.enc.json'), JSON.stringify(await encryptEnvelope(data, newPass), null, 2) + '\n');
console.log('Tracker data re-encrypted.');
console.log('\nNext: node scripts/build-html.mjs, copy dist/HPT-Tracker.html to the');
console.log('team folder, update the cloud routine’s passphrase line, and tell the team.');
