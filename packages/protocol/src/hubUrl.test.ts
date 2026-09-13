import { describe, expect, it } from 'vitest';
import { buildConnectUrl, toHttpBase } from './hubUrl.js';

describe('toHttpBase', () => {
  it('converts wss to https', () => {
    expect(toHttpBase('wss://hub.example/room/abc123')).toBe(
      'https://hub.example/room/abc123',
    );
  });

  it('converts ws to http', () => {
    expect(toHttpBase('ws://127.0.0.1:8787/room/abc123')).toBe(
      'http://127.0.0.1:8787/room/abc123',
    );
  });

  it('strips any existing query string', () => {
    expect(toHttpBase('wss://hub.example/room/abc123?device=x')).toBe(
      'https://hub.example/room/abc123',
    );
  });

  it('rejects a non-ws/wss URL instead of silently downgrading to plain http', () => {
    expect(() => toHttpBase('https://hub.example/room/abc123')).toThrow();
    expect(() => toHttpBase('http://hub.example/room/abc123')).toThrow();
  });
});

describe('buildConnectUrl', () => {
  it('adds device and token as query params', () => {
    const url = buildConnectUrl(
      'wss://hub.example/room/abc123',
      'device-1',
      'tok-1',
    );
    expect(url).toBe(
      'wss://hub.example/room/abc123?device=device-1&token=tok-1',
    );
  });
});
