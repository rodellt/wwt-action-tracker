// Rotate the team passphrase in one pass.
//   node scripts/rotate-passphrase.mjs <new-passphrase>
//
// Re-encrypts the edit key (in memory — the token is never printed) from the
// old passphrase to the new one, updates .secrets/passphrase.txt, and
// re-encrypts the tracker data. Commit and push data/*.enc.json afterwards,
// and remember: the cloud routine's instructions carry the passphrase too —
// update it at claude.ai/code/routines — and the team needs the new phrase.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptEnvelope, decryptEnvelope } from './crypto-utils.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const secretsPath = join(root, '.secrets', 'passphrase.txt');
const keyPath = join(root, 'data', 'edit-key.enc.json');

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

// 1. Re-encrypt the edit key under the new passphrase (payload preserved verbatim).
if (existsSync(keyPath)) {
  const payload = await decryptEnvelope(JSON.parse(readFileSync(keyPath, 'utf8')), oldPass);
  writeFileSync(keyPath, JSON.stringify(await encryptEnvelope(payload, newPass), null, 2) + '\n');
  console.log('Edit key re-encrypted under the new passphrase.');
} else {
  console.log('No edit key published — skipping that step.');
}

// 2. Swap the local secret.
writeFileSync(secretsPath, newPass + '\n');
console.log('.secrets/passphrase.txt updated.');

// 3. Re-encrypt the tracker data (data/data.json must be current — run sync first).
const data = JSON.parse(readFileSync(join(root, 'data', 'data.json'), 'utf8'));
writeFileSync(join(root, 'data', 'data.enc.json'), JSON.stringify(await encryptEnvelope(data, newPass), null, 2) + '\n');
console.log('Tracker data re-encrypted.');
console.log('\nNext: commit & push data/data.enc.json and data/edit-key.enc.json,');
console.log('update the cloud routine’s passphrase line, and tell the team.');
