import { fromBase64, toBase64 } from './base64.js';
import type { PairingPayload } from './types.js';

export function encodePairingPayload(payload: PairingPayload): string {
  return toBase64(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodePairingPayload(encoded: string): PairingPayload {
  const parsed = JSON.parse(new TextDecoder().decode(fromBase64(encoded))) as Partial<PairingPayload>;
  if (
    typeof parsed.v !== 'number' ||
    typeof parsed.room !== 'string' ||
    typeof parsed.salt !== 'string' ||
    typeof parsed.iterations !== 'number' ||
    typeof parsed.code !== 'string' ||
    typeof parsed.hubUrl !== 'string'
  ) {
    throw new Error('malformed pairing payload');
  }
  return parsed as PairingPayload;
}
