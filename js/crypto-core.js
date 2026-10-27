// Gedeelde versleutelcode voor browser én Node.js (beide hebben globalThis.crypto.subtle).
// Sleutel: PBKDF2-SHA256 uit het wachtwoord. Versleuteling: AES-256-GCM.
// GCM is geauthenticeerd: bij een fout wachtwoord mislukt decrypt() met een fout.
//
// De inhoud (content.enc.json) en de afbeeldingen (img/naam.enc.png) delen één sleutel: die
// komt uit het wachtwoord en het zout in content.enc.json. Zo kost het afleiden (bewust traag)
// maar één keer, bij het inloggen en bij een export; elk bestand krijgt wel een eigen IV.

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

/** Een nieuwe sleutel uit het wachtwoord, met een nieuw, willekeurig zout: { key, salt, iter }. */
export async function newKey(password, iterations = DEFAULT_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(password, salt, iterations), salt, iter: iterations };
}

/** De sleutel van een versleuteld bestand (zelfde zout en rondes), om ermee te ontsleutelen. */
export async function payloadKey(payload, password) {
  if (!payload || payload.v !== FORMAT_VERSION) {
    throw new Error('Onbekend of ontbrekend bestandsformaat (v=' + (payload && payload.v) + ')');
  }
  return deriveKey(password, fromBase64(payload.salt), payload.iter);
}

/** Versleutelt een tekst. Salt en IV zijn bij elke aanroep nieuw en willekeurig. */
export async function encryptText(plaintext, password, iterations = DEFAULT_ITERATIONS) {
  return encryptTextWith(plaintext, await newKey(password, iterations));
}

/** Versleutelt een tekst met een sleutel van newKey(); de IV is nieuw en willekeurig. */
export async function encryptTextWith(plaintext, { key, salt, iter }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  return {
    v: FORMAT_VERSION,
    kdf: 'PBKDF2-SHA256',
    cipher: 'AES-256-GCM',
    iter,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(data),
  };
}

/** Ontsleutelt een object van encryptText(). Gooit WrongPasswordError bij een fout wachtwoord. */
export async function decryptText(payload, password) {
  return decryptTextWith(payload, await payloadKey(payload, password));
}

/** Ontsleutelt een object van encryptText() met de sleutel van payloadKey(). */
export async function decryptTextWith(payload, key) {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(payload.iv) }, key, fromBase64(payload.data));
    return dec.decode(plain);
  } catch {
    throw new WrongPasswordError();
  }
}

// Een versleuteld bestand (afbeelding): "ENC" en een versienummer (4 bytes), de IV (12 bytes) en
// daarna de versleutelde bytes. Binair, zodat het niet groter wordt dan nodig.
const FILE_MAGIC = [0x45, 0x4e, 0x43, FORMAT_VERSION];

/** Versleutelt bytes (een afbeelding) met de sleutel van newKey() of payloadKey(). */
export async function encryptBytes(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(FILE_MAGIC.length + iv.length + data.length);
  out.set(FILE_MAGIC);
  out.set(iv, FILE_MAGIC.length);
  out.set(data, FILE_MAGIC.length + iv.length);
  return out;
}

/** Ontsleutelt bytes van encryptBytes(). Gooit WrongPasswordError als de sleutel niet past. */
export async function decryptBytes(bytes, key) {
  if (bytes.length < 16 + 16 || FILE_MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error('Geen versleuteld bestand (of een onbekende versie)');
  }
  try {
    const iv = bytes.subarray(FILE_MAGIC.length, FILE_MAGIC.length + 12);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(FILE_MAGIC.length + 12)));
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
