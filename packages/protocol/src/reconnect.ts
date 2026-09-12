export interface BackoffOptions {
  baseMs: number;
  factor: number;
  maxMs: number;
  jitterRatio: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 1_000,
  factor: 2,
  maxMs: 60_000,
  jitterRatio: 0.2,
};

export function computeReconnectDelay(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  rand: () => number = Math.random,
): number {
  const raw = Math.min(options.baseMs * options.factor ** attempt, options.maxMs);
  const jitter = raw * options.jitterRatio * (rand() * 2 - 1);
  return Math.max(0, Math.round(raw + jitter));
}
