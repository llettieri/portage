import type { PresencePayload, TabRef } from 'protocol';

const MIRROR_PATH = 'mirror.html';

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// The origin rule (spec §2): a tab is a mirror iff its URL is on the extension origin.
// `extensionOrigin` MUST be the origin with no trailing slash (e.g.
// "chrome-extension://<id>", not "chrome-extension://<id>/").
export function isMirrorUrl(url: string, extensionOrigin: string): boolean {
  return url.startsWith(`${extensionOrigin}/${MIRROR_PATH}`);
}

export interface MirrorUrlParams {
  deviceId: string;
  url: string;
  title: string;
}

export function buildMirrorUrl(
  extensionOrigin: string,
  params: MirrorUrlParams,
): string {
  const search = new URLSearchParams({
    d: params.deviceId,
    u: params.url,
    t: params.title,
  });
  return `${extensionOrigin}/${MIRROR_PATH}?${search.toString()}`;
}

export function buildSentinelUrl(extensionOrigin: string): string {
  return `${extensionOrigin}/${MIRROR_PATH}?sentinel=1`;
}

export function parseMirrorUrl(url: string): MirrorUrlParams | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const deviceId = parsed.searchParams.get('d');
  const tabUrl = parsed.searchParams.get('u');
  const title = parsed.searchParams.get('t');
  if (!deviceId || !tabUrl || title === null) return null;
  return { deviceId, url: tabUrl, title };
}

export interface QueryableTab {
  url?: string;
  title?: string;
  lastAccessed?: number;
}

// Sender-side half of the origin rule: drop every tab on the extension origin (prevents
// the mirror feedback loop) and anything not http(s). Sorted by lastAccessed descending so
// the publisher's truncation step (spec §3.5) can drop from the end.
export function filterPublishableTabs(
  tabs: QueryableTab[],
  extensionOrigin: string,
): TabRef[] {
  return tabs
    .filter(
      (tab): tab is QueryableTab & { url: string } =>
        typeof tab.url === 'string' &&
        isHttpUrl(tab.url) &&
        !tab.url.startsWith(`${extensionOrigin}/`),
    )
    .map((tab) => ({
      url: tab.url,
      title: tab.title ?? '',
      lastAccessed: tab.lastAccessed,
    }))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}

// The hash MUST NOT cover volatile fields (spec §4.2) — only url and title, in the given
// order. lastAccessed churns on every tab switch and must never affect this.
export async function hashTabSet(
  tabs: Array<{ url: string; title: string }>,
): Promise<string> {
  const canonical = tabs.map((tab) => `${tab.url}\0${tab.title}`).join('\n');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

export interface DesiredMirror {
  deviceId: string;
  url: string;
  title: string;
}

// Desired mirror set = for each remote device, the first maxPerDevice tabs of its stored
// snapshot, duplicate URLs within one device collapsed to one (spec §4.5), minus any URL
// the person just dismissed for that device (manually closed — stays gone until that
// device's next genuinely new snapshot, spec §4.5's "until the next snapshot").
export function computeDesiredMirrors(
  remoteSnapshots: Record<string, PresencePayload>,
  maxPerDevice: number,
  dismissed: Record<string, string[]> = {},
): DesiredMirror[] {
  const desired: DesiredMirror[] = [];
  for (const [deviceId, snapshot] of Object.entries(remoteSnapshots)) {
    const dismissedForDevice = dismissed[deviceId] ?? [];
    const seenUrls = new Set<string>();
    for (const tab of snapshot.tabs) {
      if (dismissedForDevice.includes(tab.url)) continue;
      if (seenUrls.has(tab.url)) continue;
      if (seenUrls.size >= maxPerDevice) break;
      seenUrls.add(tab.url);
      desired.push({ deviceId, url: tab.url, title: tab.title });
    }
  }
  return desired;
}

export interface ExistingMirrorTab {
  id: number;
  deviceId: string;
  url: string;
}

export interface MirrorDiff {
  toCreate: DesiredMirror[];
  toCloseIds: number[];
}

// `existing` MUST already be filtered to extension-origin (mirror) tabs by the caller —
// this never sees, and so never proposes closing, a tab the person dragged in themselves.
export function diffMirrorTabs(
  desired: DesiredMirror[],
  existing: ExistingMirrorTab[],
): MirrorDiff {
  const desiredKeys = new Set(desired.map((d) => `${d.deviceId}\0${d.url}`));
  const existingKeys = new Set(existing.map((e) => `${e.deviceId}\0${e.url}`));

  const toCreate = desired.filter(
    (d) => !existingKeys.has(`${d.deviceId}\0${d.url}`),
  );
  const toCloseIds = existing
    .filter((e) => !desiredKeys.has(`${e.deviceId}\0${e.url}`))
    .map((e) => e.id);

  return { toCreate, toCloseIds };
}

export function isCloseRequestExpired(
  requestedAt: number,
  now: number,
  ttlMs: number,
): boolean {
  return now - requestedAt > ttlMs;
}
