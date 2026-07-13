// AES-256-GCM envelope encryption with a PBKDF2-SHA256 derived key.
// Must stay byte-compatible with the WebCrypto implementation in js/app.js.
const subtle = globalThis.crypto.subtle;

const ITERATIONS = 310000;

export function bytesToB64(bytes) {
  return Buffer.from(bytes).toString('base64');
}
export function b64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function deriveKey(passphrase, salt, iterations) {
  const keyMaterial = await subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptEnvelope(obj, passphrase) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: ITERATIONS,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ct: bytesToB64(ct),
    lastUpdated: obj.lastUpdated ?? new Date().toISOString(),
  };
}

export async function decryptEnvelope(envelope, passphrase) {
  const key = await deriveKey(passphrase, b64ToBytes(envelope.salt), envelope.iter);
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(envelope.iv) }, key, b64ToBytes(envelope.ct)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}
