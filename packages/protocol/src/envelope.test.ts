import { describe, expect, it } from 'vitest';
import { buildEnvelope, openEnvelope } from './envelope.js';
import { deriveKey } from './crypto.js';
import { InvalidPayloadError } from './validate.js';

const HEADER = {
  room: 'room1',
  device: 'device-a',
  to: 'device-b',
  kind: 'handoff' as const,
};

async function testKey(): Promise<CryptoKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return deriveKey('correct horse battery staple', salt, 600_000);
}

describe('buildEnvelope / openEnvelope', () => {
  it('round-trips a handoff payload', async () => {
    const key = await testKey();
    const payload = { url: 'https://example.com', title: 'Example' };

    const envelope = await buildEnvelope(key, HEADER, payload);
    const opened = await openEnvelope(key, envelope);

    expect(opened).toEqual(payload);
  });

  it('fails when the wrong key is used', async () => {
    const key = await testKey();
    const wrongKey = await testKey();
    const envelope = await buildEnvelope(key, HEADER, {
      url: 'https://example.com',
      title: 'x',
    });

    await expect(openEnvelope(wrongKey, envelope)).rejects.toThrow();
  });

  it('fails when `kind` is tampered with after encryption', async () => {
    const key = await testKey();
    const envelope = await buildEnvelope(key, HEADER, {
      url: 'https://example.com',
      title: 'x',
    });

    const tampered = { ...envelope, kind: 'stash' as const };
    await expect(openEnvelope(key, tampered)).rejects.toThrow();
  });

  it('fails when `device` is tampered with after encryption', async () => {
    const key = await testKey();
    const envelope = await buildEnvelope(key, HEADER, {
      url: 'https://example.com',
      title: 'x',
    });

    const tampered = { ...envelope, device: 'someone-else' };
    await expect(openEnvelope(key, tampered)).rejects.toThrow();
  });

  it("rejects a payload that decrypts but does not match the kind's shape", async () => {
    const key = await testKey();
    // A well-formed stash envelope whose plaintext is not actually a stash list.
    const envelope = await buildEnvelope(key, { ...HEADER, kind: 'stash' }, {
      not: 'a stash list',
    } as never);

    await expect(openEnvelope(key, envelope)).rejects.toThrow(
      InvalidPayloadError,
    );
  });
});
