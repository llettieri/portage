import { decrypt, encrypt } from './crypto.js';
import { serializeHeader } from './header.js';
import { validateEnvelopePayload } from './validate.js';
import type { Envelope, EnvelopeHeader, HandoffPayload, PresencePayload, StashItem } from './types.js';

export async function buildEnvelope(
  key: CryptoKey,
  header: Omit<EnvelopeHeader, 'ts' | 'v'>,
  payload: HandoffPayload | PresencePayload | StashItem[],
): Promise<Envelope> {
  const ts = Date.now();
  const fullHeader: EnvelopeHeader = { v: 1, ...header, ts };
  const { iv, ciphertext } = await encrypt(key, payload, serializeHeader(fullHeader));
  return { ...fullHeader, iv, ciphertext };
}

export async function openEnvelope(
  key: CryptoKey,
  envelope: Envelope,
): Promise<HandoffPayload | PresencePayload | StashItem[]> {
  const header: EnvelopeHeader = {
    v: envelope.v,
    room: envelope.room,
    device: envelope.device,
    to: envelope.to,
    kind: envelope.kind,
    ts: envelope.ts,
  };
  const payload = await decrypt<unknown>(key, envelope, serializeHeader(header));
  return validateEnvelopePayload(envelope.kind, payload);
}
