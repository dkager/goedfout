// Gedeelde versleutelcode voor browser én Node.js (beide hebben globalThis.crypto.subtle).
// Sleutel: PBKDF2-SHA256 uit het wachtwoord. Versleuteling: AES-256-GCM.
// GCM is geauthenticeerd: bij een fout wachtwoord mislukt decrypt() met een fout.

const FORMAT_VERSION = 1;
const DEFAULT_ITERATIONS = 600_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Versleutelt een tekst. Salt en IV zijn bij elke aanroep nieuw en willekeurig. */
export async function encryptText(plaintext, password, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  return {
    v: FORMAT_VERSION,
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    iter: iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(data),
  };
}

/** Ontsleutelt een object van encryptText(). Gooit WrongPasswordError bij een fout wachtwoord. */
export async function decryptText(payload, password) {
  if (!payload || payload.v !== FORMAT_VERSION) {
    throw new Error('Onbekend of ontbrekend bestandsformaat (v=' + (payload && payload.v) + ')');
  }
  const key = await deriveKey(password, fromBase64(payload.salt), payload.iter);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(payload.iv) }, key, fromBase64(payload.data));
    return dec.decode(plain);
  } catch {
    throw new WrongPasswordError();
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Onjuist wachtwoord');
    this.name = 'WrongPasswordError';
  }
}
