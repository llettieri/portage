import { describe, expect, it } from 'vitest';
import {
  InvalidPayloadError,
  isCloseRequestPayload,
  isPresencePayload,
  validateEnvelopePayload,
} from './validate.js';

describe('validateEnvelopePayload', () => {
  it('accepts a well-shaped handoff payload', () => {
    const payload = { url: 'https://example.com', title: 'Example' };
    expect(validateEnvelopePayload('handoff', payload)).toEqual(payload);
  });

  it('rejects a handoff payload missing url', () => {
    expect(() =>
      validateEnvelopePayload('handoff', { title: 'no url' }),
    ).toThrow(InvalidPayloadError);
  });

  it('accepts a well-shaped presence payload', () => {
    const payload = {
      tabs: [{ url: 'https://a.example', title: 'A' }],
      snapshotTs: 1,
    };
    expect(validateEnvelopePayload('presence', payload)).toEqual(payload);
  });

  it('rejects a presence payload whose tabs are not an array', () => {
    expect(() => validateEnvelopePayload('presence', { tabs: 'nope' })).toThrow(
      InvalidPayloadError,
    );
  });

  it('accepts a well-shaped stash list', () => {
    const payload = [
      {
        id: '1',
        url: 'https://a.example',
        title: 'A',
        origin: 'arc',
        addedAt: 1,
      },
    ];
    expect(validateEnvelopePayload('stash', payload)).toEqual(payload);
  });

  it('rejects a stash item with an unknown origin', () => {
    const payload = [
      {
        id: '1',
        url: 'https://a.example',
        title: 'A',
        origin: 'bogus',
        addedAt: 1,
      },
    ];
    expect(() => validateEnvelopePayload('stash', payload)).toThrow(
      InvalidPayloadError,
    );
  });

  it('rejects a malformed payload rather than throwing an unrelated TypeError', () => {
    expect(() => validateEnvelopePayload('handoff', null)).toThrow(
      InvalidPayloadError,
    );
    expect(() => validateEnvelopePayload('handoff', 'just a string')).toThrow(
      InvalidPayloadError,
    );
  });
});

describe('presence / close-request validators', () => {
  it('accepts a presence payload with tabs, snapshotTs, and no truncated flag', () => {
    expect(
      isPresencePayload({
        tabs: [{ url: 'https://example.com', title: 'Example' }],
        snapshotTs: 1,
      }),
    ).toBe(true);
  });

  it('accepts a presence payload with truncated: true and a lastAccessed tab field', () => {
    expect(
      isPresencePayload({
        tabs: [
          { url: 'https://example.com', title: 'Example', lastAccessed: 5 },
        ],
        truncated: true,
        snapshotTs: 1,
      }),
    ).toBe(true);
  });

  it('rejects a presence payload missing snapshotTs', () => {
    expect(isPresencePayload({ tabs: [] })).toBe(false);
  });

  it('rejects a presence payload whose tabs are the old {url,title}-only shape without snapshotTs', () => {
    expect(isPresencePayload({ tabs: [{ url: 'x', title: 'y' }] })).toBe(false);
  });

  it('accepts a close-request payload', () => {
    expect(
      isCloseRequestPayload({ url: 'https://example.com', requestedAt: 1 }),
    ).toBe(true);
  });

  it('rejects a close-request payload missing requestedAt', () => {
    expect(isCloseRequestPayload({ url: 'https://example.com' })).toBe(false);
  });

  it('validateEnvelopePayload accepts a close-request for kind "close-request"', () => {
    const payload = { url: 'https://example.com', requestedAt: 1 };
    expect(validateEnvelopePayload('close-request', payload)).toEqual(payload);
  });

  it('validateEnvelopePayload rejects a handoff-shaped payload for kind "close-request"', () => {
    expect(() =>
      validateEnvelopePayload('close-request', { url: 'x', title: 'y' }),
    ).toThrow(InvalidPayloadError);
  });
});
