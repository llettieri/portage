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

export async function setStoredPassphrase(passphrase: string | null): Promise<void> {
  if (passphrase === null) {
    await browser.storage.session.remove('passphrase');
  } else {
    await browser.storage.session.set({ passphrase });
  }
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
  return Array.isArray(stored.pendingHandoffs) ? (stored.pendingHandoffs as PendingHandoff[]) : [];
}

export async function addPendingHandoff(item: PendingHandoff): Promise<void> {
  const existing = await getPendingHandoffs();
  if (item.id !== null && existing.some((h) => h.id === item.id)) return;
  await browser.storage.local.set({ pendingHandoffs: [...existing, item] });
}

export async function removePendingHandoff(target: PendingHandoff): Promise<void> {
  const existing = await getPendingHandoffs();
  const filtered = existing.filter((h) => !(h.url === target.url && h.title === target.title));
  await browser.storage.local.set({ pendingHandoffs: filtered });
}
