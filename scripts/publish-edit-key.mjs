// One-time setup for team editing (and revocation).
//
//   node scripts/publish-edit-key.mjs           prompt for the token, publish it
//   node scripts/publish-edit-key.mjs --remove  disable team editing
//
// The token (a fine-grained GitHub PAT for THIS repo with "Contents: Read and
// write") gets encrypted with the team passphrase from .secrets/passphrase.txt
// and committed as data/edit-key.enc.json. The webpage decrypts it after unlock,
// so anyone with the passphrase can edit — nobody ever sees or handles a token.
// The token value itself is never printed or committed in plaintext.
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encryptEnvelope } from './crypto-utils.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keyRelPath = 'data/edit-key.enc.json';
const keyPath = join(root, keyRelPath);
const git = (args) => execSync(`git ${args}`, { cwd: root, stdio: 'inherit' });

function passphrase() {
  if (process.env.TRACKER_PASSPHRASE) return process.env.TRACKER_PASSPHRASE.trim();
  try {
    return readFileSync(join(root, '.secrets', 'passphrase.txt'), 'utf8').trim();
  } catch {
    console.error('No passphrase: set TRACKER_PASSPHRASE or create .secrets/passphrase.txt');
    process.exit(1);
  }
}

if (process.argv.includes('--remove')) {
  git('pull --rebase');
  if (!existsSync(keyPath)) {
    console.log('No published edit key found — team editing is already off.');
    process.exit(0);
  }
  rmSync(keyPath);
  git(`add ${keyRelPath}`);
  git('commit -m "Disable team editing (remove edit key)"');
  git('push');
  console.log('Team editing disabled. (Also revoke the token on GitHub if it should stop working entirely.)');
  process.exit(0);
}

let token = process.env.EDIT_KEY_TOKEN?.trim();
if (!token) {
  if (!process.stdin.isTTY) {
    console.error('No token: run interactively, or set EDIT_KEY_TOKEN.');
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('Create a fine-grained GitHub token for THIS repo only, permission');
  console.log('"Contents: Read and write" (github.com → Settings → Developer settings');
  console.log('→ Fine-grained tokens). Paste it below — it is stored only encrypted.');
  token = (await rl.question('Token: ')).trim();
  rl.close();
}
if (!/^(github_pat_|ghp_)/.test(token)) {
  console.error('That does not look like a GitHub token (expected github_pat_… or ghp_…).');
  process.exit(1);
}

const envelope = await encryptEnvelope(
  { token, created: new Date().toISOString(), by: 'publish-edit-key script' },
  passphrase()
);
git('pull --rebase');
writeFileSync(keyPath, JSON.stringify(envelope, null, 2) + '\n');
git(`add ${keyRelPath}`);
git('commit -m "Enable team editing (publish encrypted edit key)"');
git('push');
console.log('\nDone — team editing is on. Anyone who unlocks the page can now edit.');
