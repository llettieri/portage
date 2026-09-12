import type { EnvelopeKind, HandoffPayload, PresencePayload, StashItem } from './types.js';

export class InvalidPayloadError extends Error {
  constructor(kind: EnvelopeKind) {
    super(`decrypted payload does not match the expected shape for kind "${kind}"`);
    this.name = 'InvalidPayloadError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isHandoffPayload(value: unknown): value is HandoffPayload {
  return isRecord(value) && typeof value.url === 'string' && typeof value.title === 'string';
}

export function isPresencePayload(value: unknown): value is PresencePayload {
  return (
    isRecord(value) &&
    Array.isArray(value.tabs) &&
    value.tabs.every((tab) => isRecord(tab) && typeof tab.url === 'string' && typeof tab.title === 'string')
  );
}

export function isStashList(value: unknown): value is StashItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.url === 'string' &&
        typeof item.title === 'string' &&
        (item.origin === 'arc' || item.origin === 'zen' || item.origin === 'sidebar') &&
        typeof item.addedAt === 'number',
    )
  );
}

export function validateEnvelopePayload(
  kind: EnvelopeKind,
  value: unknown,
): HandoffPayload | PresencePayload | StashItem[] {
  if (kind === 'handoff' && isHandoffPayload(value)) return value;
  if (kind === 'presence' && isPresencePayload(value)) return value;
  if (kind === 'stash' && isStashList(value)) return value;
  throw new InvalidPayloadError(kind);
}
