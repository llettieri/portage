import { describe, expect, it } from 'vitest';
import { InvalidPayloadError, validateEnvelopePayload } from './validate.js';

describe('validateEnvelopePayload', () => {
  it('accepts a well-shaped handoff payload', () => {
    const payload = { url: 'https://example.com', title: 'Example' };
    expect(validateEnvelopePayload('handoff', payload)).toEqual(payload);
  });

  it('rejects a handoff payload missing url', () => {
    expect(() => validateEnvelopePayload('handoff', { title: 'no url' })).toThrow(InvalidPayloadError);
  });

  it('accepts a well-shaped presence payload', () => {
    const payload = { tabs: [{ url: 'https://a.example', title: 'A' }] };
    expect(validateEnvelopePayload('presence', payload)).toEqual(payload);
  });

  it('rejects a presence payload whose tabs are not an array', () => {
    expect(() => validateEnvelopePayload('presence', { tabs: 'nope' })).toThrow(InvalidPayloadError);
  });

  it('accepts a well-shaped stash list', () => {
    const payload = [{ id: '1', url: 'https://a.example', title: 'A', origin: 'arc', addedAt: 1 }];
    expect(validateEnvelopePayload('stash', payload)).toEqual(payload);
  });

  it('rejects a stash item with an unknown origin', () => {
    const payload = [{ id: '1', url: 'https://a.example', title: 'A', origin: 'bogus', addedAt: 1 }];
    expect(() => validateEnvelopePayload('stash', payload)).toThrow(InvalidPayloadError);
  });

  it('rejects a malformed payload rather than throwing an unrelated TypeError', () => {
    expect(() => validateEnvelopePayload('handoff', null)).toThrow(InvalidPayloadError);
    expect(() => validateEnvelopePayload('handoff', 'just a string')).toThrow(InvalidPayloadError);
  });
});
