import type {
  CloseRequestPayload,
  EnvelopeKind,
  HandoffPayload,
  PresencePayload,
  StashItem,
  TabRef,
} from './types.js';

export class InvalidPayloadError extends Error {
  constructor(kind: EnvelopeKind) {
    super(
      `decrypted payload does not match the expected shape for kind "${kind}"`,
    );
    this.name = 'InvalidPayloadError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isHandoffPayload(value: unknown): value is HandoffPayload {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.title === 'string'
  );
}

export function isTabRef(value: unknown): value is TabRef {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    (value.lastAccessed === undefined || typeof value.lastAccessed === 'number')
  );
}

export function isPresencePayload(value: unknown): value is PresencePayload {
  return (
    isRecord(value) &&
    Array.isArray(value.tabs) &&
    value.tabs.every(isTabRef) &&
    typeof value.snapshotTs === 'number' &&
    (value.truncated === undefined || typeof value.truncated === 'boolean')
  );
}

export function isCloseRequestPayload(
  value: unknown,
): value is CloseRequestPayload {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.requestedAt === 'number'
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
        (item.origin === 'arc' ||
          item.origin === 'zen' ||
          item.origin === 'sidebar') &&
        typeof item.addedAt === 'number',
    )
  );
}

export function validateEnvelopePayload(
  kind: EnvelopeKind,
  value: unknown,
): HandoffPayload | PresencePayload | CloseRequestPayload | StashItem[] {
  if (kind === 'handoff' && isHandoffPayload(value)) return value;
  if (kind === 'presence' && isPresencePayload(value)) return value;
  if (kind === 'close-request' && isCloseRequestPayload(value)) return value;
  if (kind === 'stash' && isStashList(value)) return value;
  throw new InvalidPayloadError(kind);
}
