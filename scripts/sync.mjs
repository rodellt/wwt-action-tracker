// Decrypt data/data.enc.json -> data/data.json (plaintext working copy, gitignored).
// Run after `git pull` so web-made changes (e.g. items completed from the page)
// land in the working copy before you edit it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptEnvelope } from './crypto-utils.mjs';

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

const envelope = JSON.parse(readFileSync(join(root, 'data', 'data.enc.json'), 'utf8'));
const data = await decryptEnvelope(envelope, passphrase());
writeFileSync(join(root, 'data', 'data.json'), JSON.stringify(data, null, 2) + '\n');
console.log(`Decrypted data/data.enc.json (lastUpdated ${data.lastUpdated}) -> data/data.json`);
