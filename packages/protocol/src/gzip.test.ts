import { describe, expect, it } from 'vitest';
import { gunzip, gzip } from './gzip.js';

describe('gzip / gunzip', () => {
  it('round-trips arbitrary bytes', async () => {
    const original = new TextEncoder().encode(
      JSON.stringify({ hello: 'world', n: 42 }),
    );
    const compressed = await gzip(original);
    const decompressed = await gunzip(compressed);
    expect(decompressed).toEqual(original);
  });

  it('round-trips an empty payload', async () => {
    const original = new Uint8Array(0);
    const compressed = await gzip(original);
    expect(await gunzip(compressed)).toEqual(original);
  });

  it('shrinks a highly repetitive payload', async () => {
    const original = new TextEncoder().encode(
      'https://example.com/'.repeat(500),
    );
    const compressed = await gzip(original);
    expect(compressed.byteLength).toBeLessThan(original.byteLength / 4);
  });
});
