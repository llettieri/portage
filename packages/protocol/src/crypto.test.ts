import { describe, expect, it } from 'vitest';
import {
  CURRENT_PBKDF2_ITERATIONS,
  decrypt,
  decryptBytes,
  deriveKey,
  encrypt,
  encryptBytes,
} from './crypto.js';

const AAD = new TextEncoder().encode('room1\0device1\0all\0handoff\0' + '1');
const OTHER_AAD = new TextEncoder().encode(
  'room1\0device1\0all\0stash\0' + '1',
);

describe('crypto round-trip', () => {
  it('decrypts a payload encrypted with the same passphrase, salt, and AAD', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(
      'correct horse battery staple',
      salt,
      CURRENT_PBKDF2_ITERATIONS,
    );
    const payload = { url: 'https://example.com', title: 'Example' };

    const envelope = await encrypt(key, payload, AAD);
    const result = await decrypt(key, envelope, AAD);

    expect(result).toEqual(payload);
  });

  it('uses a fresh IV per message', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(
      'correct horse battery staple',
      salt,
      CURRENT_PBKDF2_ITERATIONS,
    );

    const first = await encrypt(key, { n: 1 }, AAD);
    const second = await encrypt(key, { n: 1 }, AAD);

    expect(first.iv).not.toEqual(second.iv);
  });

  it('fails to decrypt with the wrong passphrase', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(
      'correct horse battery staple',
      salt,
      CURRENT_PBKDF2_ITERATIONS,
    );
    const wrongKey = await deriveKey(
      'wrong passphrase',
      salt,
      CURRENT_PBKDF2_ITERATIONS,
    );
    const envelope = await encrypt(key, { secret: true }, AAD);

    await expect(decrypt(wrongKey, envelope, AAD)).rejects.toThrow();
  });

  it('fails to decrypt when the bound header (AAD) does not match', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(
      'correct horse battery staple',
      salt,
      CURRENT_PBKDF2_ITERATIONS,
    );
    const envelope = await encrypt(key, { secret: true }, AAD);

    await expect(decrypt(key, envelope, OTHER_AAD)).rejects.toThrow();
  });

  it('meets the current OWASP PBKDF2-HMAC-SHA256 iteration floor', () => {
    expect(CURRENT_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('fails to decrypt when the iteration count used to derive the key differs', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(
      'correct horse battery staple',
      salt,
      CURRENT_PBKDF2_ITERATIONS,
    );
    const otherIterationsKey = await deriveKey(
      'correct horse battery staple',
      salt,
      250_000,
    );
    const envelope = await encrypt(key, { secret: true }, AAD);

    await expect(decrypt(otherIterationsKey, envelope, AAD)).rejects.toThrow();
  });
});

describe('encryptBytes / decryptBytes', () => {
  it('round-trips raw bytes', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(
      'correct horse battery staple',
      salt,
      CURRENT_PBKDF2_ITERATIONS,
    );
    const plaintext = new TextEncoder().encode('raw bytes, not JSON');

    const payload = await encryptBytes(key, plaintext, AAD);
    const result = await decryptBytes(key, payload, AAD);

    expect(result).toEqual(plaintext);
  });

  it('fails to decrypt bytes with the wrong AAD', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(
      'correct horse battery staple',
      salt,
      CURRENT_PBKDF2_ITERATIONS,
    );
    const payload = await encryptBytes(key, new TextEncoder().encode('x'), AAD);

    await expect(decryptBytes(key, payload, OTHER_AAD)).rejects.toThrow();
  });
});
