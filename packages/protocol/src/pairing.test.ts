import { describe, expect, it } from 'vitest';
import { decodePairingPayload, encodePairingPayload } from './pairing.js';

describe('pairing payload codec', () => {
  it('round-trips', () => {
    const payload = {
      v: 1,
      room: 'a1b2c3',
      salt: 'c2FsdA==',
      iterations: 600_000,
      code: 'ABCD1234',
      hubUrl: 'wss://hub.example/room/a1b2c3',
    };
    expect(decodePairingPayload(encodePairingPayload(payload))).toEqual(payload);
  });

  it('rejects malformed input rather than returning a partial object', () => {
    expect(() => decodePairingPayload('not-base64-json')).toThrow();
    expect(() => decodePairingPayload(btoa(JSON.stringify({ room: 'only-room' })))).toThrow();
  });
});
