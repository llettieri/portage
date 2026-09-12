import type { EnvelopeHeader } from './types.js';

export function serializeHeader(header: EnvelopeHeader): Uint8Array {
  for (const field of [header.room, header.device, header.to, header.kind]) {
    if (field.includes('\0')) {
      throw new Error('EnvelopeHeader field contains a NUL byte');
    }
  }
  const canonical = [String(header.v), header.room, header.device, header.to, header.kind, String(header.ts)].join(
    '\0',
  );
  return new TextEncoder().encode(canonical);
}
