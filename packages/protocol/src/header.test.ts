import { describe, expect, it } from 'vitest';
import { serializeHeader } from './header.js';

describe('serializeHeader', () => {
  it('is deterministic for the same fields', () => {
    const header = { room: 'r1', device: 'd1', to: 'd2', kind: 'handoff' as const, ts: 100 };
    expect(serializeHeader(header)).toEqual(serializeHeader({ ...header }));
  });

  it('changes when any field changes', () => {
    const base = { room: 'r1', device: 'd1', to: 'd2', kind: 'handoff' as const, ts: 100 };
    const variants = [
      { ...base, room: 'r2' },
      { ...base, device: 'd9' },
      { ...base, to: 'all' },
      { ...base, kind: 'presence' as const },
      { ...base, ts: 101 },
    ];
    const baseline = serializeHeader(base);
    for (const variant of variants) {
      expect(serializeHeader(variant)).not.toEqual(baseline);
    }
  });

  it('throws when a field contains a NUL byte', () => {
    const header = { room: 'r1', device: 'd1\0evil', to: 'd2', kind: 'handoff' as const, ts: 100 };
    expect(() => serializeHeader(header)).toThrow();
  });
});
