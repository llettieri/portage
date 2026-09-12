import { describe, expect, it } from 'vitest';
import { hashToken, randomPairingCode, randomToken } from './tokens.js';

describe('tokens', () => {
  it('generates distinct tokens each call', () => {
    expect(randomToken()).not.toEqual(randomToken());
  });

  it('generates a pairing code from an unambiguous alphabet', () => {
    const code = randomPairingCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('hashes the same token to the same digest', async () => {
    const token = randomToken();
    expect(await hashToken(token)).toEqual(await hashToken(token));
  });

  it('hashes different tokens to different digests', async () => {
    expect(await hashToken('a')).not.toEqual(await hashToken('b'));
  });
});
