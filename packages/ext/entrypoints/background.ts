import {
  buildConnectUrl,
  buildEnvelope,
  computeReconnectDelay,
  CLOSE_REQUEST_TTL_MS,
  CURRENT_PBKDF2_ITERATIONS,
  decodePairingPayload,
  decrypt,
  deriveKey,
  encrypt,
  encodePairingPayload,
  fromBase64,
  MAX_MIRROR_TABS_PER_DEVICE,
  MAX_PAYLOAD_BYTES,
  openEnvelope,
  PRESENCE_EXPIRY_MS,
  toBase64,
  toHttpBase,
  type CloseRequestPayload,
  type EnvelopeKind,
  type HandoffPayload,
  type InboxDrainResponse,
  type PresencePayload,
  type RelayFrame,
  type StashItem,
} from 'protocol';
import {
  addClosingTabId,
  addDismissedMirror,
  addPendingHandoff,
  clearDeviceId,
  clearDismissedMirrorsForDevice,
  clearLiveSyncState,
  clearPendingHandoffs,
  clearRoomConfig,
  getClosingTabIds,
  getDeviceId,
  getDismissedMirrors,
  getLastPublishedAt,
  getLastSnapshotHash,
  getLiveSync,
  getMirrorTabIndex,
  getRemoteSnapshots,
  getRoomConfig,
  getSentinelTabId,
  getStoredPassphrase,
  removeClosingTabId,
  setConnected,
  setDecryptError,
  setLastPublishedAt,
  setLastSnapshotHash,
  setLiveSync,
  setLiveSyncError,
  setMirrorTabIndex,
  setRemoteSnapshot,
  setRoomConfig,
  setSentinelTabId,
  setStoredPassphrase,
  type MirrorTabInfo,
  type RoomConfig,
} from '../lib/state.js';
import {
  buildMirrorUrl,
  buildSentinelUrl,
  classifyTabRemoval,
  computeDesiredMirrors,
  diffMirrorTabs,
  filterPublishableTabs,
  hashTabSet,
  isCloseRequestExpired,
  isMirrorUrl,
  parseMirrorUrl,
  type ExistingMirrorTab,
} from '../lib/liveSync.js';

const RECONNECT_ALARM = 'portage-reconnect';
const KEY_CHECK_VALUE = 'portage-key-check-v1';
let socket: WebSocket | null = null;
let connecting: Promise<void> | null = null;
let reconnectAttempt = 0;
// Fast path within a single service-worker wake — cleared whenever the worker is
// evicted and restarted. resolveCryptoKey() falls back to re-deriving from the
// persisted passphrase (browser.storage.session) when this is empty. Kept
// unconditionally on both build targets: harmless extra defensiveness on Firefox's
// persistent background page, required on Chrome's evictable service worker.
let cachedCryptoKey: CryptoKey | null = null;

async function resolveCryptoKey(): Promise<CryptoKey | null> {
  if (cachedCryptoKey) return cachedCryptoKey;
  const passphrase = await getStoredPassphrase();
  const config = await getRoomConfig();
  if (!passphrase || !config) return null;
  cachedCryptoKey = await deriveKey(
    passphrase,
    fromBase64(config.salt),
    config.iterations,
  );
  return cachedCryptoKey;
}

function extensionOrigin(): string {
  return browser.runtime.getURL('').replace(/\/$/, '');
}

// The origin rule (spec §8.7) cuts both ways: a mirror that navigates away from the
// extension origin is an ordinary tab from that moment on, and must stop being tracked as
// a mirror everywhere — the reconciler (already URL-driven) and this index alike.
async function handleTabUpdated(tabId: number, url: string): Promise<void> {
  if (isMirrorUrl(url, extensionOrigin())) return;
  const index = await getMirrorTabIndex();
  if (!(tabId in index)) return;
  const rest = { ...index };
  delete rest[tabId];
  await setMirrorTabIndex(rest);
}

async function publishPresence(): Promise<void> {
  const liveSync = await getLiveSync();
  if (!liveSync) return;
  const config = await getRoomConfig();
  if (!config) {
    await setLiveSyncError('no room configured');
    return;
  }
  const cryptoKey = await resolveCryptoKey();
  if (!cryptoKey) {
    await setLiveSyncError('room is locked');
    return;
  }
  // publishPresence runs fire-and-forget alongside connect() on the same alarm tick — wait
  // for a connection attempt here rather than only checking whatever state a *previous*
  // tick left behind, or almost every tick right after a worker restart reports "not
  // connected" even though a connection is actually in progress.
  await connect().catch(() => {});
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    await setLiveSyncError('not connected to hub');
    return;
  }

  const deviceId = await getDeviceId();
  const rawTabs = await browser.tabs.query({});
  const tabs = filterPublishableTabs(rawTabs, extensionOrigin());
  const hash = await hashTabSet(tabs);
  const previousHash = await getLastSnapshotHash();
  const lastPublishedAt = await getLastPublishedAt();
  // An unchanged hash normally means "nothing to publish" (spec §7.6's change-gated
  // publishing) — but a newly-paired or long-offline peer needs a fresh copy regardless,
  // since the hub expires presence rows after PRESENCE_EXPIRY_MS and a device whose own
  // tabs never change would otherwise never resend. Force a republish once the last one is
  // stale enough that the hub's copy may already be gone.
  const isStale =
    lastPublishedAt === null ||
    Date.now() - lastPublishedAt > PRESENCE_EXPIRY_MS / 2;
  if (hash === previousHash && !isStale) {
    await setLiveSyncError(null);
    return;
  }

  let candidateTabs = tabs;
  let truncated = false;
  let envelope = await buildEnvelope(
    cryptoKey,
    { room: config.roomId, device: deviceId, to: 'all', kind: 'presence' },
    {
      tabs: candidateTabs,
      truncated,
      snapshotTs: Date.now(),
    } satisfies PresencePayload,
  );
  while (
    new TextEncoder().encode(JSON.stringify(envelope)).length >
      MAX_PAYLOAD_BYTES &&
    candidateTabs.length > 0
  ) {
    candidateTabs = candidateTabs.slice(0, -1);
    truncated = true;
    envelope = await buildEnvelope(
      cryptoKey,
      { room: config.roomId, device: deviceId, to: 'all', kind: 'presence' },
      {
        tabs: candidateTabs,
        truncated,
        snapshotTs: Date.now(),
      } satisfies PresencePayload,
    );
  }
  if (
    new TextEncoder().encode(JSON.stringify(envelope)).length >
    MAX_PAYLOAD_BYTES
  ) {
    // Truncated all the way to zero tabs and it *still* doesn't fit — the envelope
    // overhead alone exceeds the cap. Vanishingly unlikely, but report it rather than
    // silently sending an oversized message the hub will reject.
    await setLiveSyncError('snapshot too large to send, even with zero tabs');
    return;
  }

  socket.send(JSON.stringify(envelope));
  await setLastSnapshotHash(hash);
  await setLastPublishedAt(Date.now());
  await setLiveSyncError(null);
}

let reconciling: Promise<void> | null = null;

function reconcile(): Promise<void> {
  if (!reconciling) {
    reconciling = doReconcile().finally(() => {
      reconciling = null;
    });
  }
  return reconciling;
}

async function doReconcile(): Promise<void> {
  const liveSync = await getLiveSync();
  if (!liveSync) return;
  const config = await getRoomConfig();
  if (!config) return;

  const origin = extensionOrigin();
  const sentinelUrl = buildSentinelUrl(origin);
  let allTabs = await browser.tabs.query({});
  const existingSentinel = allTabs.find((tab) => tab.url === sentinelUrl);

  let windowId: number;
  let sentinelTabId: number;
  if (
    existingSentinel &&
    typeof existingSentinel.windowId === 'number' &&
    typeof existingSentinel.id === 'number'
  ) {
    windowId = existingSentinel.windowId;
    sentinelTabId = existingSentinel.id;
  } else {
    // browser.windows.create resolves to `Window | undefined` — both the window and its
    // opened tab must be checked, not just truthiness-tested, or a missing id (0 is a
    // legal window id) would be mistaken for failure.
    const created = await browser.windows.create({
      url: sentinelUrl,
      focused: false,
    });
    const createdTab = created?.tabs?.[0];
    if (typeof created?.id !== 'number' || typeof createdTab?.id !== 'number') {
      return;
    }
    windowId = created.id;
    sentinelTabId = createdTab.id;
    await browser.tabs.update(sentinelTabId, { pinned: true });
    allTabs = await browser.tabs.query({});
  }
  await setSentinelTabId(sentinelTabId);

  const remoteSnapshots = await getRemoteSnapshots();
  const dismissed = await getDismissedMirrors();
  const desired = computeDesiredMirrors(
    remoteSnapshots,
    MAX_MIRROR_TABS_PER_DEVICE,
    dismissed,
  );

  const windowTabs = allTabs.filter((tab) => tab.windowId === windowId);
  const existingMirrors: ExistingMirrorTab[] = [];
  for (const tab of windowTabs) {
    if (typeof tab.id !== 'number' || typeof tab.url !== 'string') continue;
    if (tab.url === sentinelUrl || !isMirrorUrl(tab.url, origin)) continue;
    const parsed = parseMirrorUrl(tab.url);
    if (!parsed) continue;
    existingMirrors.push({
      id: tab.id,
      deviceId: parsed.deviceId,
      url: parsed.url,
    });
  }

  const { toCreate, toCloseIds } = diffMirrorTabs(desired, existingMirrors);
  const toCloseIdSet = new Set(toCloseIds);

  const index: Record<number, MirrorTabInfo> = {};
  for (const mirror of existingMirrors) {
    if (!toCloseIdSet.has(mirror.id)) {
      index[mirror.id] = { deviceId: mirror.deviceId, url: mirror.url };
    }
  }

  for (const mirror of toCreate) {
    // Skip creating a mirror when its URL is already open in any tab, anywhere — mirroring
    // a tab the person already has open is noise. This includes a visited mirror: once a
    // mirror navigates to the real URL it leaves the extension origin (spec §8.7) and is an
    // ordinary tab whose url === mirror.url, exactly the case this must not re-mirror. An
    // unvisited mirror's own URL is always the mirror.html?… wrapper, never mirror.url
    // itself, so this can only ever match a genuinely-already-open tab.
    const alreadyOpenElsewhere = allTabs.some((tab) => tab.url === mirror.url);
    if (alreadyOpenElsewhere) continue;
    const createdTab = await browser.tabs.create({
      windowId,
      url: buildMirrorUrl(origin, mirror),
      active: false,
    });
    if (typeof createdTab.id === 'number') {
      index[createdTab.id] = { deviceId: mirror.deviceId, url: mirror.url };
    }
  }

  for (const tabId of toCloseIds) {
    await addClosingTabId(tabId);
    await browser.tabs.remove(tabId);
  }

  await setMirrorTabIndex(index);
}

async function applyCloseRequest(payload: CloseRequestPayload): Promise<void> {
  if (
    isCloseRequestExpired(payload.requestedAt, Date.now(), CLOSE_REQUEST_TTL_MS)
  ) {
    return;
  }
  const origin = extensionOrigin();
  const allTabs = await browser.tabs.query({});
  const matches = allTabs.filter(
    (tab) => tab.url === payload.url && !isMirrorUrl(tab.url ?? '', origin),
  );
  if (matches.length === 0) return; // already gone — the common case, not an error
  const target = matches.reduce((oldest, tab) =>
    (tab.lastAccessed ?? 0) < (oldest.lastAccessed ?? 0) ? tab : oldest,
  );
  if (typeof target.id !== 'number') return;
  await browser.tabs.remove(target.id);
}

async function applyPayload(
  kind: EnvelopeKind,
  payload: HandoffPayload | PresencePayload | CloseRequestPayload | StashItem[],
  senderDeviceId: string,
  itemId: string | null,
): Promise<void> {
  if (kind === 'handoff') {
    const handoff = payload as HandoffPayload;
    await addPendingHandoff({
      id: itemId,
      url: handoff.url,
      title: handoff.title,
    });
    return;
  }
  if (kind === 'presence') {
    const presence = payload as PresencePayload;
    const existing = (await getRemoteSnapshots())[senderDeviceId];
    const isIdentical =
      existing !== undefined &&
      existing.snapshotTs === presence.snapshotTs &&
      existing.truncated === presence.truncated &&
      JSON.stringify(existing.tabs) === JSON.stringify(presence.tabs);
    // A redelivered (duplicate) frame is identical to what's already stored — skip the
    // write entirely, not just the reconcile, so it doesn't fire storage.onChanged and
    // churn the popup/sentinel on every redelivery (spec §7.5 — recipients MUST tolerate a
    // redelivered frame).
    if (isIdentical) return;
    await setRemoteSnapshot(senderDeviceId, {
      ...presence,
      receivedAt: Date.now(),
    });
    // A genuinely new snapshot from this device is "the next snapshot" any locally
    // dismissed (manually closed) mirror for it was waiting for (spec §8.7) — clear the
    // dismissal whether or not the new snapshot still contains that URL.
    await clearDismissedMirrorsForDevice(senderDeviceId);
    await reconcile();
    return;
  }
  if (kind === 'close-request') {
    await applyCloseRequest(payload as CloseRequestPayload);
  }
}

async function removeFromMirrorTabIndex(tabId: number): Promise<void> {
  const index = await getMirrorTabIndex();
  if (!(tabId in index)) return;
  const rest = { ...index };
  delete rest[tabId];
  await setMirrorTabIndex(rest);
}

async function sendCloseRequest(
  toDeviceId: string,
  url: string,
): Promise<void> {
  await connect().catch(() => {});
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const cryptoKey = await resolveCryptoKey();
  if (!cryptoKey) return;
  const config = await getRoomConfig();
  if (!config) return;
  const deviceId = await getDeviceId();
  const envelope = await buildEnvelope(
    cryptoKey,
    {
      room: config.roomId,
      device: deviceId,
      to: toDeviceId,
      kind: 'close-request',
    },
    { url, requestedAt: Date.now() } satisfies CloseRequestPayload,
  );
  socket.send(JSON.stringify(envelope));
}

// Turning the toggle off (spec §8.7) is a local action: every mirror tab and the sentinel
// must be torn down, and marking each id via addClosingTabId first means handleTabRemoved
// treats these as reconciler-initiated closes (silent, no close-request) rather than manual
// closes — going dark on live-sync must never notify another device.
async function teardownMirrorWindow(): Promise<void> {
  const index = await getMirrorTabIndex();
  const sentinelTabId = await getSentinelTabId();
  const idsToClose = Object.keys(index).map(Number);
  if (sentinelTabId !== null) idsToClose.push(sentinelTabId);
  for (const tabId of idsToClose) {
    await addClosingTabId(tabId);
    await browser.tabs.remove(tabId).catch(() => {});
  }
  await setMirrorTabIndex({});
  await setSentinelTabId(null);
}

async function handleTabRemoved(
  tabId: number,
  removeInfo: { windowId: number; isWindowClosing: boolean },
): Promise<void> {
  const closingIds = await getClosingTabIds();
  const sentinelTabId = await getSentinelTabId();
  const index = await getMirrorTabIndex();
  const classification = classifyTabRemoval({
    tabId,
    isWindowClosing: removeInfo.isWindowClosing,
    closingTabIds: closingIds,
    sentinelTabId,
    mirrorTabIndex: index,
  });

  if (classification.kind === 'reconciler-initiated') {
    // Reconciler-initiated close — clean up bookkeeping, send no close-request.
    await removeClosingTabId(tabId);
    await removeFromMirrorTabIndex(tabId);
    return;
  }
  if (classification.kind === 'window-closed') {
    // The whole mirror window went away — tabs.onRemoved fires once per tab it contained,
    // not once for the window, so isWindowClosing MUST be combined with "this tab is one
    // we track" before it means anything (classifyTabRemoval does this): without it,
    // closing an unrelated browser window would silently turn liveSync off, or every
    // mirror tab in a closed window would fall through to the "person closed one mirror by
    // hand" branch and fire a close-request for each one, closing real tabs on other
    // devices. Pause, don't recreate it (spec §8.7) — the popup toggle turns it back on.
    await setLiveSync(false);
    await setLiveSyncError(null);
    await setMirrorTabIndex({});
    await setSentinelTabId(null);
    return;
  }
  if (classification.kind === 'manual-mirror-close') {
    const { info } = classification;
    // A person closed a mirror by hand: tell its origin device, then dismiss it locally so
    // reconcile doesn't immediately recreate it. It reappears once the origin publishes a
    // genuinely new snapshot (spec §8.7; the dismissal is cleared by
    // clearDismissedMirrorsForDevice() when that snapshot arrives).
    await removeFromMirrorTabIndex(tabId);
    await addDismissedMirror(info.deviceId, info.url);
    await sendCloseRequest(info.deviceId, info.url);
  }
}

async function computeKeyCheck(
  key: CryptoKey,
): Promise<{ iv: string; ciphertext: string }> {
  const { iv, ciphertext } = await encrypt(
    key,
    KEY_CHECK_VALUE,
    new Uint8Array(),
  );
  return { iv, ciphertext };
}

async function verifyKeyCheck(
  key: CryptoKey,
  keyCheck: { iv: string; ciphertext: string },
): Promise<boolean> {
  try {
    const value = await decrypt<string>(
      key,
      { iv: keyCheck.iv, ciphertext: keyCheck.ciphertext },
      new Uint8Array(),
    );
    return value === KEY_CHECK_VALUE;
  } catch {
    return false;
  }
}

function randomHex(byteLength: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteLength)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

async function setupCreate(
  passphrase: string,
  hubBaseUrl: string,
): Promise<{ pairingPayloadOut: string }> {
  const deviceId = await getDeviceId();
  const roomId = randomHex(16);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = CURRENT_PBKDF2_ITERATIONS;
  const hubUrl = `${hubBaseUrl.replace(/\/$/, '')}/room/${roomId}`;

  const issueRes = await fetch(`${toHttpBase(hubUrl)}/pair/issue`, {
    method: 'POST',
    body: JSON.stringify({ device: deviceId }),
  });
  if (!issueRes.ok) throw new Error(`pair/issue failed: ${issueRes.status}`);
  const { code, deviceToken } = (await issueRes.json()) as {
    code: string;
    deviceToken: string;
  };
  if (!deviceToken)
    throw new Error('pair/issue did not bootstrap a device token');

  const key = await deriveKey(passphrase, salt, iterations);
  cachedCryptoKey = key;
  const keyCheck = await computeKeyCheck(key);
  const config: RoomConfig = {
    roomId,
    hubUrl,
    salt: toBase64(salt),
    iterations,
    deviceToken,
    keyCheck,
  };
  await setRoomConfig(config);
  await setStoredPassphrase(passphrase);

  const pairingPayloadOut = encodePairingPayload({
    v: 1,
    room: roomId,
    salt: config.salt,
    iterations,
    code,
    hubUrl,
  });
  return { pairingPayloadOut };
}

async function inviteDevice(): Promise<{ pairingPayloadOut: string }> {
  const config = await getRoomConfig();
  if (!config) throw new Error('no room configured');
  const deviceId = await getDeviceId();

  const issueRes = await fetch(`${toHttpBase(config.hubUrl)}/pair/issue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.deviceToken}` },
    body: JSON.stringify({ device: deviceId }),
  });
  if (!issueRes.ok) throw new Error(`pair/issue failed: ${issueRes.status}`);
  const { code } = (await issueRes.json()) as { code: string };

  const pairingPayloadOut = encodePairingPayload({
    v: 1,
    room: config.roomId,
    salt: config.salt,
    iterations: config.iterations,
    code,
    hubUrl: config.hubUrl,
  });
  return { pairingPayloadOut };
}

async function setupJoin(
  passphrase: string,
  pairingPayload: string,
): Promise<void> {
  const deviceId = await getDeviceId();
  const payload = decodePairingPayload(pairingPayload);

  const consumeRes = await fetch(`${toHttpBase(payload.hubUrl)}/pair/consume`, {
    method: 'POST',
    body: JSON.stringify({ code: payload.code, device: deviceId }),
  });
  if (!consumeRes.ok)
    throw new Error(`pair/consume failed: ${consumeRes.status}`);
  const { deviceToken } = (await consumeRes.json()) as { deviceToken: string };

  const key = await deriveKey(
    passphrase,
    fromBase64(payload.salt),
    payload.iterations,
  );
  cachedCryptoKey = key;
  const keyCheck = await computeKeyCheck(key);
  const config: RoomConfig = {
    roomId: payload.room,
    hubUrl: payload.hubUrl,
    salt: payload.salt,
    iterations: payload.iterations,
    deviceToken,
    keyCheck,
  };
  await setRoomConfig(config);
  await setStoredPassphrase(passphrase);
}

async function unlock(passphrase: string): Promise<void> {
  const config = await getRoomConfig();
  if (!config) throw new Error('no room configured');
  const candidateKey = await deriveKey(
    passphrase,
    fromBase64(config.salt),
    config.iterations,
  );
  if (!(await verifyKeyCheck(candidateKey, config.keyCheck))) {
    throw new Error('wrong passphrase');
  }
  cachedCryptoKey = candidateKey;
  await setStoredPassphrase(passphrase);
}

async function forgetRoom(): Promise<void> {
  await clearRoomConfig();
  await clearDeviceId();
  await clearPendingHandoffs();
  await teardownMirrorWindow();
  await clearLiveSyncState();
  await setDecryptError(false);
  cachedCryptoKey = null;
  await setStoredPassphrase(null);
  if (socket) {
    socket.close();
    socket = null;
  }
  await setConnected(false);
}

function connect(): Promise<void> {
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve();
  if (!connecting) {
    connecting = doConnect().finally(() => {
      connecting = null;
    });
  }
  return connecting;
}

async function doConnect(): Promise<void> {
  const config = await getRoomConfig();
  if (!config) return;
  const deviceId = await getDeviceId();

  const ws = new WebSocket(
    buildConnectUrl(config.hubUrl, deviceId, config.deviceToken),
  );
  socket = ws;

  ws.addEventListener('close', () => {
    void setConnected(false);
    if (socket === ws) socket = null;
    const delay = computeReconnectDelay(reconnectAttempt);
    reconnectAttempt += 1;
    setTimeout(() => void connect().catch(() => {}), delay);
  });
  ws.addEventListener('error', () => ws.close());
  ws.addEventListener(
    'message',
    (event) => void handleIncomingFrame(event.data),
  );

  // Resolve only on 'open' — a socket that closes before ever opening (hub unreachable,
  // bad URL, unauthorized) must reject, not resolve, or callers see a "connected" promise
  // for a dead socket and skip straight to failing on the send.
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener(
      'open',
      () => {
        reconnectAttempt = 0;
        void setConnected(true);
        void drainInbox();
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      'close',
      () => reject(new Error('socket closed before opening')),
      { once: true },
    );
  });
}

async function drainInbox(): Promise<void> {
  try {
    const config = await getRoomConfig();
    const cryptoKey = await resolveCryptoKey();
    if (!config || !cryptoKey) return;
    const deviceId = await getDeviceId();

    let items: InboxDrainResponse['items'];
    try {
      const res = await fetch(`${toHttpBase(config.hubUrl)}/inbox/drain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.deviceToken}` },
        body: JSON.stringify({ device: deviceId }),
      });
      if (!res.ok) return;
      ({ items } = (await res.json()) as InboxDrainResponse);
    } catch {
      return;
    }

    const ackIds: string[] = [];
    for (const item of items) {
      let payload;
      try {
        payload = await openEnvelope(cryptoKey, item.envelope);
      } catch {
        await setDecryptError(true);
        // Do not ack — an item that failed to decrypt (e.g. because the passphrase was
        // wrong at the time) must still be redelivered once the human fixes it.
        continue;
      }
      await setDecryptError(false);
      try {
        await applyPayload(
          item.envelope.kind,
          payload,
          item.envelope.device,
          item.id,
        );
        if (item.id) ackIds.push(item.id);
      } catch {
        // Storage failed for a genuinely-decrypted item — don't ack, so it's redelivered
        // and retried next drain, but don't misreport this as a decrypt/passphrase problem.
      }
    }

    if (ackIds.length > 0) {
      try {
        await fetch(`${toHttpBase(config.hubUrl)}/inbox/ack`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.deviceToken}` },
          body: JSON.stringify({ device: deviceId, ids: ackIds }),
        });
      } catch {
        // Ack failed — items get redelivered (harmless, addPendingHandoff dedupes by id)
        // and re-acked on the next successful drain.
      }
    }
  } catch {
    // Any unexpected failure (e.g. storage access rejecting during context teardown) —
    // drainInbox must never reject, since every caller invokes it fire-and-forget.
  }
}

async function handleIncomingFrame(data: unknown): Promise<void> {
  if (typeof data !== 'string') return;
  const cryptoKey = await resolveCryptoKey();
  if (!cryptoKey) return;
  let frame: RelayFrame;
  try {
    frame = JSON.parse(data) as RelayFrame;
  } catch {
    return;
  }
  let payload;
  try {
    payload = await openEnvelope(cryptoKey, frame.envelope);
  } catch {
    await setDecryptError(true);
    return;
  }

  await setDecryptError(false);
  // Never open a received URL here — only store or act on it. A handoff is opened only by
  // a direct popup click (spec §8.4); a mirror tab only navigates on visibility (spec §8.7).
  await applyPayload(
    frame.envelope.kind,
    payload,
    frame.envelope.device,
    frame.id,
  );
}

async function sendCurrentTab(to: string): Promise<void> {
  await connect();
  if (!socket || socket.readyState !== WebSocket.OPEN)
    throw new Error('not connected to hub');
  const cryptoKey = await resolveCryptoKey();
  if (!cryptoKey)
    throw new Error('room is locked — unlock with your passphrase first');
  const config = await getRoomConfig();
  if (!config) throw new Error('no room configured');
  const deviceId = await getDeviceId();
  // Neither an MV3 service worker nor an MV2 background page has a guaranteed "current
  // window" — currentWindow silently matches nothing in either context.
  const [tab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab?.url) throw new Error('no active tab with a URL found');

  const envelope = await buildEnvelope(
    cryptoKey,
    { room: config.roomId, device: deviceId, to, kind: 'handoff' },
    { url: tab.url, title: tab.title ?? '' },
  );
  socket.send(JSON.stringify(envelope));
}

export default defineBackground({
  persistent: true,
  main() {
    browser.runtime.onStartup.addListener(() => {
      void connect().catch(() => {});
      void reconcile().catch(() => {});
    });
    browser.runtime.onInstalled.addListener(() => {
      void connect().catch(() => {});
      void reconcile().catch(() => {});
    });
    browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === RECONNECT_ALARM) {
        void connect().catch(() => {});
        void drainInbox();
        void publishPresence();
        void reconcile().catch(() => {});
      }
    });

    browser.tabs.onRemoved.addListener(
      (tabId, removeInfo) => void handleTabRemoved(tabId, removeInfo),
    );

    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (typeof changeInfo.url !== 'string') return;
      void handleTabUpdated(tabId, changeInfo.url);
    });

    browser.runtime.onMessage.addListener(
      (
        message: {
          type?: string;
          passphrase?: string;
          hubBaseUrl?: string;
          pairingPayload?: string;
          value?: boolean;
        },
        _sender,
        sendResponse,
      ) => {
        if (
          message?.type === 'setup-create' &&
          message.passphrase &&
          message.hubBaseUrl
        ) {
          void setupCreate(message.passphrase, message.hubBaseUrl)
            .then((result) =>
              connect().then(() => sendResponse({ ok: true, ...result })),
            )
            .catch((error: unknown) =>
              sendResponse({ ok: false, error: String(error) }),
            );
          return true;
        }
        if (
          message?.type === 'setup-join' &&
          message.passphrase &&
          message.pairingPayload
        ) {
          void setupJoin(message.passphrase, message.pairingPayload)
            .then(() => connect())
            .then(() => sendResponse({ ok: true }))
            .catch((error: unknown) =>
              sendResponse({ ok: false, error: String(error) }),
            );
          return true;
        }
        if (message?.type === 'invite-device') {
          void inviteDevice()
            .then((result) => sendResponse({ ok: true, ...result }))
            .catch((error: unknown) =>
              sendResponse({ ok: false, error: String(error) }),
            );
          return true;
        }
        if (message?.type === 'send-tab') {
          void sendCurrentTab('all')
            .then(() => sendResponse({ ok: true }))
            .catch((error: unknown) =>
              sendResponse({ ok: false, error: String(error) }),
            );
          return true;
        }
        if (message?.type === 'drain') {
          void drainInbox().then(() => sendResponse({ ok: true }));
          return true;
        }
        if (message?.type === 'forget-room') {
          void forgetRoom().then(() => sendResponse({ ok: true }));
          return true;
        }
        if (message?.type === 'unlock' && message.passphrase) {
          void unlock(message.passphrase)
            .then(() => connect())
            // connect() is a no-op when the socket is already open — exactly the
            // connected-but-locked case Unlock exists for — so drain explicitly here
            // instead of waiting for the next alarm tick to surface anything queued.
            .then(() => drainInbox())
            .then(() => sendResponse({ ok: true }))
            .catch((error: unknown) =>
              sendResponse({ ok: false, error: String(error) }),
            );
          return true;
        }
        if (message?.type === 'is-unlocked') {
          void resolveCryptoKey().then((key) =>
            sendResponse({ unlocked: !!key }),
          );
          return true;
        }
        if (message?.type === 'is-connected') {
          sendResponse({
            connected: socket !== null && socket.readyState === WebSocket.OPEN,
          });
          return true;
        }
        if (
          message?.type === 'set-live-sync' &&
          typeof message.value === 'boolean'
        ) {
          void setLiveSync(message.value)
            .then(() => {
              if (!message.value) {
                return Promise.all([
                  teardownMirrorWindow(),
                  setLiveSyncError(null),
                ]).then(() => undefined);
              }
              return Promise.all([publishPresence(), reconcile()]).then(
                () => undefined,
              );
            })
            .then(() => sendResponse({ ok: true }))
            .catch((error: unknown) =>
              sendResponse({ ok: false, error: String(error) }),
            );
          return true;
        }
        return false;
      },
    );

    void connect().catch(() => {});
  },
});
