import { describe, expect, it } from 'vitest';
import { computeReconnectDelay, DEFAULT_BACKOFF } from './reconnect.js';

const noJitter = () => 0.5; // rand() * 2 - 1 === 0 at 0.5

describe('computeReconnectDelay', () => {
  it('starts at roughly the base delay on the first attempt', () => {
    expect(computeReconnectDelay(0, DEFAULT_BACKOFF, noJitter)).toBe(DEFAULT_BACKOFF.baseMs);
  });

  it('doubles per attempt without jitter', () => {
    expect(computeReconnectDelay(1, DEFAULT_BACKOFF, noJitter)).toBe(DEFAULT_BACKOFF.baseMs * 2);
    expect(computeReconnectDelay(2, DEFAULT_BACKOFF, noJitter)).toBe(DEFAULT_BACKOFF.baseMs * 4);
  });

  it('never exceeds the configured ceiling', () => {
    expect(computeReconnectDelay(20, DEFAULT_BACKOFF, noJitter)).toBe(DEFAULT_BACKOFF.maxMs);
  });

  it('applies jitter within the configured ratio', () => {
    const withMaxPositiveJitter = computeReconnectDelay(0, DEFAULT_BACKOFF, () => 1);
    const withMaxNegativeJitter = computeReconnectDelay(0, DEFAULT_BACKOFF, () => 0);
    expect(withMaxPositiveJitter).toBe(
      Math.round(DEFAULT_BACKOFF.baseMs + DEFAULT_BACKOFF.baseMs * DEFAULT_BACKOFF.jitterRatio),
    );
    expect(withMaxNegativeJitter).toBe(
      Math.round(DEFAULT_BACKOFF.baseMs - DEFAULT_BACKOFF.baseMs * DEFAULT_BACKOFF.jitterRatio),
    );
  });

  it('never returns a negative delay', () => {
    expect(computeReconnectDelay(0, DEFAULT_BACKOFF, () => 0)).toBeGreaterThanOrEqual(0);
  });
});
