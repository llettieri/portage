import { describe, expect, it } from 'vitest';
import { isEchoableCloseCode } from './closeCodes.js';

describe('isEchoableCloseCode', () => {
  it('accepts 1000 (normal closure)', () => {
    expect(isEchoableCloseCode(1000)).toBe(true);
  });

  it('accepts the 3000-4999 application range', () => {
    expect(isEchoableCloseCode(3000)).toBe(true);
    expect(isEchoableCloseCode(4999)).toBe(true);
  });

  it('rejects 1006 (abnormal closure, reserved, cannot be sent)', () => {
    expect(isEchoableCloseCode(1006)).toBe(false);
  });

  it('rejects codes outside both ranges', () => {
    expect(isEchoableCloseCode(1001)).toBe(false);
    expect(isEchoableCloseCode(2999)).toBe(false);
    expect(isEchoableCloseCode(5000)).toBe(false);
  });
});
