import { fromBase64, toBase64 } from './base64.js';

export const CURRENT_PBKDF2_ITERATIONS = 600_000;
const IV_BYTES = 12;

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  additionalData: Uint8Array,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData as BufferSource },
    key,
    plaintext as BufferSource,
  );
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function decryptBytes(
  key: CryptoKey,
  payload: EncryptedPayload,
  additionalData: Uint8Array,
): Promise<Uint8Array> {
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      additionalData: additionalData as BufferSource,
    },
    key,
    ciphertext as BufferSource,
  );
  return new Uint8Array(plaintext);
}

export async function encrypt(
  key: CryptoKey,
  payload: unknown,
  additionalData: Uint8Array,
): Promise<EncryptedPayload> {
  return encryptBytes(
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
    additionalData,
  );
}

export async function decrypt<T>(
  key: CryptoKey,
  envelope: EncryptedPayload,
  additionalData: Uint8Array,
): Promise<T> {
  const bytes = await decryptBytes(key, envelope, additionalData);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
