import { describe, expect, it } from 'vitest';
import {
  buildMirrorUrl,
  buildSentinelUrl,
  classifyTabRemoval,
  computeDesiredMirrors,
  diffMirrorTabs,
  filterPublishableTabs,
  hashTabSet,
  isCloseRequestExpired,
  isHttpUrl,
  isMirrorUrl,
  parseMirrorUrl,
} from './liveSync.js';

const ORIGIN = 'chrome-extension://abc123';

describe('isHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('https://example.com')).toBe(true);
  });

  it('rejects other schemes', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('chrome://extensions')).toBe(false);
    expect(isHttpUrl('data:text/html,hi')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});

describe('isMirrorUrl', () => {
  it('matches a mirror.html URL on the given origin', () => {
    expect(isMirrorUrl(`${ORIGIN}/mirror.html?d=x&u=y&t=z`, ORIGIN)).toBe(true);
  });

  it('rejects a URL on a different origin', () => {
    expect(isMirrorUrl('https://example.com/mirror.html', ORIGIN)).toBe(false);
  });

  it('rejects a non-mirror page on the same origin', () => {
    expect(isMirrorUrl(`${ORIGIN}/popup.html`, ORIGIN)).toBe(false);
  });
});

describe('buildMirrorUrl / parseMirrorUrl', () => {
  it('round-trips device id, url, and title', () => {
    const params = {
      deviceId: 'device-a',
      url: 'https://example.com/a?b=c&d=e',
      title: 'A title, with punctuation!',
    };
    const url = buildMirrorUrl(ORIGIN, params);
    expect(parseMirrorUrl(url)).toEqual(params);
  });

  it('returns null for a URL missing required params', () => {
    expect(parseMirrorUrl(`${ORIGIN}/mirror.html?d=x`)).toBeNull();
  });

  it('returns null for an unparseable URL', () => {
    expect(parseMirrorUrl('not a url')).toBeNull();
  });
});

describe('buildSentinelUrl', () => {
  it('produces a mirror.html URL with sentinel=1', () => {
    expect(buildSentinelUrl(ORIGIN)).toBe(`${ORIGIN}/mirror.html?sentinel=1`);
  });
});

describe('filterPublishableTabs', () => {
  it('drops non-http(s) tabs and extension-origin tabs — the origin rule / loop prevention', () => {
    const tabs = [
      { url: 'https://example.com', title: 'Example', lastAccessed: 1 },
      {
        url: `${ORIGIN}/mirror.html?d=x&u=y&t=z`,
        title: 'Mirror',
        lastAccessed: 2,
      },
      { url: `${ORIGIN}/popup.html`, title: 'Popup', lastAccessed: 3 },
      { url: 'chrome://extensions', title: 'Extensions', lastAccessed: 4 },
      { url: 'javascript:void(0)', title: 'JS', lastAccessed: 5 },
    ];
    const result = filterPublishableTabs(tabs, ORIGIN);
    expect(result).toEqual([
      { url: 'https://example.com', title: 'Example', lastAccessed: 1 },
    ]);
  });

  it('sorts by lastAccessed descending', () => {
    const tabs = [
      { url: 'https://a.com', title: 'A', lastAccessed: 1 },
      { url: 'https://b.com', title: 'B', lastAccessed: 3 },
      { url: 'https://c.com', title: 'C', lastAccessed: 2 },
    ];
    expect(filterPublishableTabs(tabs, ORIGIN).map((t) => t.url)).toEqual([
      'https://b.com',
      'https://c.com',
      'https://a.com',
    ]);
  });

  it('defaults a missing title to an empty string', () => {
    expect(filterPublishableTabs([{ url: 'https://a.com' }], ORIGIN)).toEqual([
      { url: 'https://a.com', title: '', lastAccessed: undefined },
    ]);
  });

  it('drops tabs with no url', () => {
    expect(filterPublishableTabs([{ title: 'no url' }], ORIGIN)).toEqual([]);
  });
});

describe('hashTabSet', () => {
  it('is stable for the same ordered input', async () => {
    const tabs = [{ url: 'https://a.com', title: 'A' }];
    expect(await hashTabSet(tabs)).toBe(await hashTabSet(tabs));
  });

  it('changes when tab order changes — the hash covers the ordered list', async () => {
    const a = [
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
    ];
    const b = [
      { url: 'https://b.com', title: 'B' },
      { url: 'https://a.com', title: 'A' },
    ];
    expect(await hashTabSet(a)).not.toBe(await hashTabSet(b));
  });

  it('ignores lastAccessed — the hash MUST NOT cover volatile fields', async () => {
    const a = [{ url: 'https://a.com', title: 'A', lastAccessed: 1 }];
    const b = [{ url: 'https://a.com', title: 'A', lastAccessed: 999 }];
    expect(await hashTabSet(a)).toBe(await hashTabSet(b));
  });

  it('changes when a title changes', async () => {
    const a = [{ url: 'https://a.com', title: 'A' }];
    const b = [{ url: 'https://a.com', title: 'A (renamed)' }];
    expect(await hashTabSet(a)).not.toBe(await hashTabSet(b));
  });
});

describe('computeDesiredMirrors', () => {
  it('includes tabs from every device', () => {
    const snapshots = {
      'device-a': {
        tabs: [{ url: 'https://a.com', title: 'A' }],
        snapshotTs: 1,
      },
      'device-b': {
        tabs: [{ url: 'https://b.com', title: 'B' }],
        snapshotTs: 1,
      },
    };
    const desired = computeDesiredMirrors(snapshots, 50);
    expect(desired).toEqual([
      { deviceId: 'device-a', url: 'https://a.com', title: 'A' },
      { deviceId: 'device-b', url: 'https://b.com', title: 'B' },
    ]);
  });

  it('collapses duplicate URLs within one device to one mirror', () => {
    const snapshots = {
      'device-a': {
        tabs: [
          { url: 'https://a.com', title: 'First' },
          { url: 'https://a.com', title: 'Second' },
        ],
        snapshotTs: 1,
      },
    };
    expect(computeDesiredMirrors(snapshots, 50)).toEqual([
      { deviceId: 'device-a', url: 'https://a.com', title: 'First' },
    ]);
  });

  it('caps at maxPerDevice, keeping the first N in snapshot order', () => {
    const snapshots = {
      'device-a': {
        tabs: [
          { url: 'https://a.com', title: 'A' },
          { url: 'https://b.com', title: 'B' },
          { url: 'https://c.com', title: 'C' },
        ],
        snapshotTs: 1,
      },
    };
    expect(computeDesiredMirrors(snapshots, 2).map((m) => m.url)).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('excludes a dismissed URL for that device but not for another device', () => {
    const snapshots = {
      'device-a': {
        tabs: [{ url: 'https://a.com', title: 'A' }],
        snapshotTs: 1,
      },
      'device-b': {
        tabs: [{ url: 'https://a.com', title: 'A (on b)' }],
        snapshotTs: 1,
      },
    };
    const dismissed = { 'device-a': ['https://a.com'] };
    expect(computeDesiredMirrors(snapshots, 50, dismissed)).toEqual([
      { deviceId: 'device-b', url: 'https://a.com', title: 'A (on b)' },
    ]);
  });
});

describe('diffMirrorTabs', () => {
  it('creates missing desired mirrors and closes stale existing ones', () => {
    const desired = [
      { deviceId: 'device-a', url: 'https://a.com', title: 'A' },
      { deviceId: 'device-a', url: 'https://new.com', title: 'New' },
    ];
    const existing = [
      { id: 1, deviceId: 'device-a', url: 'https://a.com' },
      { id: 2, deviceId: 'device-a', url: 'https://stale.com' },
    ];
    const { toCreate, toCloseIds } = diffMirrorTabs(desired, existing);
    expect(toCreate).toEqual([
      { deviceId: 'device-a', url: 'https://new.com', title: 'New' },
    ]);
    expect(toCloseIds).toEqual([2]);
  });

  it('creates everything when nothing exists yet', () => {
    const desired = [
      { deviceId: 'device-a', url: 'https://a.com', title: 'A' },
    ];
    expect(diffMirrorTabs(desired, [])).toEqual({
      toCreate: desired,
      toCloseIds: [],
    });
  });

  it('closes everything when nothing is desired anymore', () => {
    const existing = [{ id: 1, deviceId: 'device-a', url: 'https://a.com' }];
    expect(diffMirrorTabs([], existing)).toEqual({
      toCreate: [],
      toCloseIds: [1],
    });
  });
});

describe('classifyTabRemoval', () => {
  it('classifies a tab in closingTabIds as reconciler-initiated, regardless of other state', () => {
    expect(
      classifyTabRemoval({
        tabId: 7,
        isWindowClosing: true,
        closingTabIds: [7],
        sentinelTabId: 7,
        mirrorTabIndex: { 7: { deviceId: 'device-a', url: 'https://a.com' } },
      }),
    ).toEqual({ kind: 'reconciler-initiated' });
  });

  it('classifies a tracked mirror tab closing with its window as window-closed', () => {
    expect(
      classifyTabRemoval({
        tabId: 3,
        isWindowClosing: true,
        closingTabIds: [],
        sentinelTabId: 99,
        mirrorTabIndex: { 3: { deviceId: 'device-a', url: 'https://a.com' } },
      }),
    ).toEqual({ kind: 'window-closed' });
  });

  it('classifies the sentinel tab itself as window-closed, even without isWindowClosing', () => {
    expect(
      classifyTabRemoval({
        tabId: 99,
        isWindowClosing: false,
        closingTabIds: [],
        sentinelTabId: 99,
        mirrorTabIndex: {},
      }),
    ).toEqual({ kind: 'window-closed' });
  });

  it('classifies a manually closed tracked mirror (window staying open) as manual-mirror-close', () => {
    const info = { deviceId: 'device-a', url: 'https://a.com' };
    expect(
      classifyTabRemoval({
        tabId: 3,
        isWindowClosing: false,
        closingTabIds: [],
        sentinelTabId: 99,
        mirrorTabIndex: { 3: info },
      }),
    ).toEqual({ kind: 'manual-mirror-close', info });
  });

  it('ignores an untracked tab from an unrelated window closing, even with isWindowClosing true', () => {
    // This is the bug this whole review cycle found: isWindowClosing alone must never be
    // read as "the mirror window closed" — it's true for every tab of ANY window that just
    // closed, not only the mirror window.
    expect(
      classifyTabRemoval({
        tabId: 42,
        isWindowClosing: true,
        closingTabIds: [],
        sentinelTabId: 99,
        mirrorTabIndex: { 3: { deviceId: 'device-a', url: 'https://a.com' } },
      }),
    ).toEqual({ kind: 'ignore' });
  });
});

describe('isCloseRequestExpired', () => {
  it('is not expired exactly at the TTL boundary', () => {
    expect(isCloseRequestExpired(1000, 1000 + 60_000, 60_000)).toBe(false);
  });

  it('is expired just past the TTL', () => {
    expect(isCloseRequestExpired(1000, 1000 + 60_001, 60_000)).toBe(true);
  });

  it('is not expired well within the TTL', () => {
    expect(isCloseRequestExpired(1000, 1500, 60_000)).toBe(false);
  });
});
