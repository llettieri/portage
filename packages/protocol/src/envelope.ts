import { decryptBytes, encryptBytes } from './crypto.js';
import { gunzip, gzip } from './gzip.js';
import { serializeHeader } from './header.js';
import { validateEnvelopePayload } from './validate.js';
import type {
  CloseRequestPayload,
  Envelope,
  EnvelopeHeader,
  HandoffPayload,
  PresencePayload,
  StashItem,
} from './types.js';

export const ENVELOPE_VERSION = 2;

export class UnsupportedEnvelopeVersionError extends Error {
  constructor(version: number) {
    super(`received envelope has unsupported version ${version}`);
    this.name = 'UnsupportedEnvelopeVersionError';
  }
}

export async function buildEnvelope(
  key: CryptoKey,
  header: Omit<EnvelopeHeader, 'ts' | 'v'>,
  payload:
    | HandoffPayload
    | PresencePayload
    | CloseRequestPayload
    | StashItem[],
): Promise<Envelope> {
  const ts = Date.now();
  const fullHeader: EnvelopeHeader = { ...header, v: ENVELOPE_VERSION, ts };
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const compressed = await gzip(plaintext);
  const { iv, ciphertext } = await encryptBytes(
    key,
    compressed,
    serializeHeader(fullHeader),
  );
  return { ...fullHeader, iv, ciphertext };
}

export async function openEnvelope(
  key: CryptoKey,
  envelope: Envelope,
): Promise<
  HandoffPayload | PresencePayload | CloseRequestPayload | StashItem[]
> {
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new UnsupportedEnvelopeVersionError(envelope.v);
  }
  const header: EnvelopeHeader = {
    v: envelope.v,
    room: envelope.room,
    device: envelope.device,
    to: envelope.to,
    kind: envelope.kind,
    ts: envelope.ts,
  };
  const compressed = await decryptBytes(
    key,
    envelope,
    serializeHeader(header),
  );
  const plaintext = await gunzip(compressed);
  const payload: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  return validateEnvelopePayload(envelope.kind, payload);
}
