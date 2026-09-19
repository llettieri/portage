import { describe, expect, it } from 'vitest';
import {
  buildEnvelope,
  ENVELOPE_VERSION,
  openEnvelope,
  UnsupportedEnvelopeVersionError,
} from './envelope.js';
import { deriveKey } from './crypto.js';
import { InvalidPayloadError } from './validate.js';
import { MAX_PAYLOAD_BYTES } from './limits.js';

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

describe('envelope v2', () => {
  it('round-trips a presence payload', async () => {
    const key = await testKey();
    const payload = {
      tabs: [{ url: 'https://example.com', title: 'Example', lastAccessed: 1 }],
      snapshotTs: 2,
    };

    const envelope = await buildEnvelope(
      key,
      { ...HEADER, kind: 'presence' },
      payload,
    );
    expect(envelope.v).toBe(ENVELOPE_VERSION);
    const opened = await openEnvelope(key, envelope);

    expect(opened).toEqual(payload);
  });

  it('round-trips a close-request payload', async () => {
    const key = await testKey();
    const payload = { url: 'https://example.com', requestedAt: 5 };

    const envelope = await buildEnvelope(
      key,
      { ...HEADER, kind: 'close-request' },
      payload,
    );
    const opened = await openEnvelope(key, envelope);

    expect(opened).toEqual(payload);
  });

  it('round-trips a stash payload', async () => {
    const key = await testKey();
    const payload = [
      {
        id: '1',
        url: 'https://example.com',
        title: 'Example',
        origin: 'arc' as const,
        addedAt: 1,
      },
    ];

    const envelope = await buildEnvelope(
      key,
      { ...HEADER, kind: 'stash' },
      payload,
    );
    const opened = await openEnvelope(key, envelope);

    expect(opened).toEqual(payload);
  });

  it('throws UnsupportedEnvelopeVersionError, not a decryption error, for a v1 envelope', async () => {
    const key = await testKey();
    const envelope = await buildEnvelope(key, HEADER, {
      url: 'https://example.com',
      title: 'x',
    });
    const v1Envelope = { ...envelope, v: 1 };

    await expect(openEnvelope(key, v1Envelope)).rejects.toThrow(
      UnsupportedEnvelopeVersionError,
    );
  });

  it('fails when `room` is tampered with after encryption', async () => {
    const key = await testKey();
    const envelope = await buildEnvelope(key, HEADER, {
      url: 'https://example.com',
      title: 'x',
    });
    const tampered = { ...envelope, room: 'someone-elses-room' };
    await expect(openEnvelope(key, tampered)).rejects.toThrow();
  });

  it('fails when `to` is tampered with after encryption', async () => {
    const key = await testKey();
    const envelope = await buildEnvelope(key, HEADER, {
      url: 'https://example.com',
      title: 'x',
    });
    const tampered = { ...envelope, to: 'a-different-device' };
    await expect(openEnvelope(key, tampered)).rejects.toThrow();
  });

  it('fails when `ts` is tampered with after encryption', async () => {
    const key = await testKey();
    const envelope = await buildEnvelope(key, HEADER, {
      url: 'https://example.com',
      title: 'x',
    });
    const tampered = { ...envelope, ts: envelope.ts + 1 };
    await expect(openEnvelope(key, tampered)).rejects.toThrow();
  });

  it('a 500-tab presence payload gzips to well under the plaintext budget', async () => {
    const key = await testKey();
    const tabs = Array.from({ length: 500 }, (_, i) => ({
      url: `https://example.com/page-${i}`,
      title: `Page ${i} — a reasonably descriptive title`,
      lastAccessed: i,
    }));

    const envelope = await buildEnvelope(
      key,
      { ...HEADER, kind: 'presence' },
      {
        tabs,
        snapshotTs: 1,
      },
    );

    const envelopeBytes = new TextEncoder().encode(
      JSON.stringify(envelope),
    ).length;
    expect(envelopeBytes).toBeLessThan(MAX_PAYLOAD_BYTES);
  });
});
