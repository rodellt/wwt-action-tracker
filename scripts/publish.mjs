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
writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');

const envelope = await encryptEnvelope(data, passphrase());
writeFileSync(outPath, JSON.stringify(envelope, null, 2) + '\n');
console.log(`Encrypted ${dataPath}`);
console.log(`      -> ${outPath} (${envelope.ct.length} b64 chars, lastUpdated ${envelope.lastUpdated})`);
