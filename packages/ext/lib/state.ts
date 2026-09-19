import type { PresencePayload } from 'protocol';

export async function getDeviceId(): Promise<string> {
  const stored = await browser.storage.local.get('deviceId');
  if (typeof stored.deviceId === 'string') return stored.deviceId;
  const deviceId = crypto.randomUUID();
  await browser.storage.local.set({ deviceId });
  return deviceId;
}

export interface RoomConfig {
  roomId: string;
  hubUrl: string;
  salt: string;
  iterations: number;
  deviceToken: string;
  keyCheck: { iv: string; ciphertext: string };
}

export async function getRoomConfig(): Promise<RoomConfig | null> {
  const stored = await browser.storage.local.get('roomConfig');
  return (stored.roomConfig as RoomConfig | undefined) ?? null;
}

export async function setRoomConfig(config: RoomConfig): Promise<void> {
  await browser.storage.local.set({ roomConfig: config });
}

export async function clearRoomConfig(): Promise<void> {
  await browser.storage.local.remove('roomConfig');
}

export async function clearDeviceId(): Promise<void> {
  await browser.storage.local.remove('deviceId');
}

export async function clearPendingHandoffs(): Promise<void> {
  await browser.storage.local.remove('pendingHandoffs');
}

export async function getConnected(): Promise<boolean> {
  const stored = await browser.storage.local.get('connected');
  return typeof stored.connected === 'boolean' ? stored.connected : false;
}

export async function setConnected(connected: boolean): Promise<void> {
  await browser.storage.local.set({ connected });
}

// A plain module-level variable does not survive MV3 service-worker termination —
// Chrome can kill an idle service worker at any moment, and the next event re-executes
// the script from scratch, resetting every module global. browser.storage.session is
// the MV3-native fix: memory-only (never touches disk, cleared when the browser
// closes), but it survives individual service-worker restarts within a session. Used
// unconditionally on both build targets — unnecessary on Firefox's persistent
// background page, but harmless, and one implementation avoids a per-target branch.
//
// A CryptoKey object itself can't be round-tripped through browser.storage.session —
// its key material is opaque to JS (no enumerable properties), so storing one silently
// drops it instead of throwing. Persist the passphrase instead (a plain string,
// guaranteed to serialize) and re-derive the key from it plus the already-stored
// salt/iterations whenever needed.
export async function getStoredPassphrase(): Promise<string | null> {
  const stored = await browser.storage.session.get('passphrase');
  return typeof stored.passphrase === 'string' ? stored.passphrase : null;
}

export async function setStoredPassphrase(
  passphrase: string | null,
): Promise<void> {
  if (passphrase === null) {
    await browser.storage.session.remove('passphrase');
  } else {
    await browser.storage.session.set({ passphrase });
  }
}

export interface SetupDraft {
  host: string;
  useTls: boolean;
  pairingPayloadIn: string;
}

const emptyDraft: SetupDraft = {
  host: '',
  useTls: false,
  pairingPayloadIn: '',
};

// Draft inputs for the not-yet-configured setup form (host, TLS toggle, pasted pairing
// payload) so reopening the popup doesn't lose what was typed. The passphrase is
// deliberately excluded — unlike this draft, it's a secret, and every other passphrase
// path in this file goes through storage.session (memory-only), never storage.local.
export async function getSetupDraft(): Promise<SetupDraft> {
  const stored = await browser.storage.local.get('setupDraft');
  return {
    ...emptyDraft,
    ...(stored.setupDraft as Partial<SetupDraft> | undefined),
  };
}

export async function setSetupDraft(draft: SetupDraft): Promise<void> {
  await browser.storage.local.set({ setupDraft: draft });
}

export async function getDecryptError(): Promise<boolean> {
  const stored = await browser.storage.local.get('decryptError');
  return typeof stored.decryptError === 'boolean' ? stored.decryptError : false;
}

export async function setDecryptError(value: boolean): Promise<void> {
  await browser.storage.local.set({ decryptError: value });
}

export interface PendingHandoff {
  id: string | null;
  url: string;
  title: string;
}

export async function getPendingHandoffs(): Promise<PendingHandoff[]> {
  const stored = await browser.storage.local.get('pendingHandoffs');
  return Array.isArray(stored.pendingHandoffs)
    ? (stored.pendingHandoffs as PendingHandoff[])
    : [];
}

export async function addPendingHandoff(item: PendingHandoff): Promise<void> {
  const existing = await getPendingHandoffs();
  if (item.id !== null && existing.some((h) => h.id === item.id)) return;
  await browser.storage.local.set({ pendingHandoffs: [...existing, item] });
}

export async function removePendingHandoff(
  target: PendingHandoff,
): Promise<void> {
  const existing = await getPendingHandoffs();
  const filtered = existing.filter(
    (h) => !(h.url === target.url && h.title === target.title),
  );
  await browser.storage.local.set({ pendingHandoffs: filtered });
}

export async function getLiveSync(): Promise<boolean> {
  const stored = await browser.storage.local.get('liveSync');
  return typeof stored.liveSync === 'boolean' ? stored.liveSync : false;
}

export async function setLiveSync(value: boolean): Promise<void> {
  await browser.storage.local.set({ liveSync: value });
}

export async function getLastSnapshotHash(): Promise<string | null> {
  const stored = await browser.storage.local.get('lastSnapshotHash');
  return typeof stored.lastSnapshotHash === 'string'
    ? stored.lastSnapshotHash
    : null;
}

export async function setLastSnapshotHash(hash: string): Promise<void> {
  await browser.storage.local.set({ lastSnapshotHash: hash });
}

// Tracked separately from lastSnapshotHash so publishPresence() can force a republish once
// this is stale, even when the tab set itself hasn't changed — otherwise a newly-paired or
// long-offline device could see an empty or stale mirror forever, since the hub expires
// presence rows (PRESENCE_EXPIRY_MS) and an unchanging sender never resends on its own.
export async function getLastPublishedAt(): Promise<number | null> {
  const stored = await browser.storage.local.get('lastPublishedAt');
  return typeof stored.lastPublishedAt === 'number'
    ? stored.lastPublishedAt
    : null;
}

export async function setLastPublishedAt(timestamp: number): Promise<void> {
  await browser.storage.local.set({ lastPublishedAt: timestamp });
}

export interface RemoteSnapshot extends PresencePayload {
  receivedAt: number;
}

export async function getRemoteSnapshots(): Promise<
  Record<string, RemoteSnapshot>
  > {
  const stored = await browser.storage.local.get('remoteSnapshots');
  return (
    (stored.remoteSnapshots as Record<string, RemoteSnapshot> | undefined) ?? {}
  );
}

export async function setRemoteSnapshot(
  deviceId: string,
  snapshot: RemoteSnapshot,
): Promise<void> {
  const existing = await getRemoteSnapshots();
  await browser.storage.local.set({
    remoteSnapshots: { ...existing, [deviceId]: snapshot },
  });
}

// Session storage (not module globals — CLAUDE.md #2) for tab ids the reconciler is
// currently closing, so the tabs.onRemoved listener can tell "we closed this mirror" from
// "the person closed this mirror" and only send a close-request for the latter.
export async function getClosingTabIds(): Promise<number[]> {
  const stored = await browser.storage.session.get('closingTabIds');
  return Array.isArray(stored.closingTabIds)
    ? (stored.closingTabIds as number[])
    : [];
}

export async function addClosingTabId(tabId: number): Promise<void> {
  const existing = await getClosingTabIds();
  if (existing.includes(tabId)) return;
  await browser.storage.session.set({ closingTabIds: [...existing, tabId] });
}

export async function removeClosingTabId(tabId: number): Promise<void> {
  const existing = await getClosingTabIds();
  await browser.storage.session.set({
    closingTabIds: existing.filter((id) => id !== tabId),
  });
}

export interface MirrorTabInfo {
  deviceId: string;
  url: string;
}

// browser.tabs.onRemoved fires with only a tabId — never the removed tab's former URL —
// so identifying which remote device's mirror just closed requires having recorded the
// mapping beforehand. Session storage, not a module global, so it survives a
// service-worker restart between the mirror being created and it being closed.
export async function getMirrorTabIndex(): Promise<
  Record<number, MirrorTabInfo>
  > {
  const stored = await browser.storage.session.get('mirrorTabIndex');
  return (
    (stored.mirrorTabIndex as Record<number, MirrorTabInfo> | undefined) ?? {}
  );
}

export async function setMirrorTabIndex(
  index: Record<number, MirrorTabInfo>,
): Promise<void> {
  await browser.storage.session.set({ mirrorTabIndex: index });
}

// Same rationale as mirrorTabIndex: onRemoved gives no way to tell "the sentinel tab (and
// so the whole mirror window) just closed" without already knowing its tabId.
export async function getSentinelTabId(): Promise<number | null> {
  const stored = await browser.storage.session.get('sentinelTabId');
  return typeof stored.sentinelTabId === 'number' ? stored.sentinelTabId : null;
}

export async function setSentinelTabId(tabId: number | null): Promise<void> {
  if (tabId === null) {
    await browser.storage.session.remove('sentinelTabId');
  } else {
    await browser.storage.session.set({ sentinelTabId: tabId });
  }
}

// Manually closing a mirror drops it from the desired set "until the next snapshot" (spec
// §4.5). Tracked as its own per-device dismissal set — rather than editing the stored copy
// of the remote device's snapshot in place — so the §4.3 identical-snapshot check and the
// sentinel's overflow list keep seeing the real, unmodified last-received snapshot.
export async function getDismissedMirrors(): Promise<Record<string, string[]>> {
  const stored = await browser.storage.session.get('dismissedMirrors');
  return (
    (stored.dismissedMirrors as Record<string, string[]> | undefined) ?? {}
  );
}

export async function addDismissedMirror(
  deviceId: string,
  url: string,
): Promise<void> {
  const existing = await getDismissedMirrors();
  const forDevice = existing[deviceId] ?? [];
  if (forDevice.includes(url)) return;
  await browser.storage.session.set({
    dismissedMirrors: { ...existing, [deviceId]: [...forDevice, url] },
  });
}

// Called whenever a genuinely new (non-identical) snapshot arrives from this device — that
// is "the next snapshot" the dismissal was waiting for, whether or not it still contains
// the dismissed URL.
export async function clearDismissedMirrorsForDevice(
  deviceId: string,
): Promise<void> {
  const existing = await getDismissedMirrors();
  if (!(deviceId in existing)) return;
  const rest = { ...existing };
  delete rest[deviceId];
  await browser.storage.session.set({ dismissedMirrors: rest });
}

// Mirrors the decryptError pattern: a transient status flag the popup reads reactively via
// storage.onChanged, since publishPresence() runs on a timer with no caller to report to
// directly. A publish that did not happen MUST NOT read as success (spec §11 — failures are
// reported, never swallowed).
export async function getLiveSyncError(): Promise<string | null> {
  const stored = await browser.storage.local.get('liveSyncError');
  return typeof stored.liveSyncError === 'string' ? stored.liveSyncError : null;
}

export async function setLiveSyncError(value: string | null): Promise<void> {
  if (value === null) {
    await browser.storage.local.remove('liveSyncError');
  } else {
    await browser.storage.local.set({ liveSyncError: value });
  }
}

export async function clearLiveSyncState(): Promise<void> {
  await browser.storage.local.remove([
    'liveSync',
    'lastSnapshotHash',
    'lastPublishedAt',
    'remoteSnapshots',
    'liveSyncError',
  ]);
  await browser.storage.session.remove([
    'closingTabIds',
    'mirrorTabIndex',
    'sentinelTabId',
    'dismissedMirrors',
  ]);
}
