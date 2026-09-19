import {
  buildConnectUrl,
  buildEnvelope,
  computeReconnectDelay,
  CURRENT_PBKDF2_ITERATIONS,
  decodePairingPayload,
  decrypt,
  deriveKey,
  encrypt,
  encodePairingPayload,
  fromBase64,
  MAX_PAYLOAD_BYTES,
  openEnvelope,
  toBase64,
  toHttpBase,
  type HandoffPayload,
  type InboxDrainResponse,
  type PresencePayload,
  type RelayFrame,
} from 'protocol';
import {
  addPendingHandoff,
  clearDeviceId,
  clearLiveSyncState,
  clearPendingHandoffs,
  clearRoomConfig,
  getDeviceId,
  getLastSnapshotHash,
  getLiveSync,
  getRoomConfig,
  getStoredPassphrase,
  setConnected,
  setDecryptError,
  setLastSnapshotHash,
  setLiveSyncError,
  setRoomConfig,
  setStoredPassphrase,
  type RoomConfig,
} from '../lib/state.js';
import { filterPublishableTabs, hashTabSet } from '../lib/liveSync.js';

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
  if (hash === previousHash) {
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
    new TextEncoder().encode(JSON.stringify(envelope)).length > MAX_PAYLOAD_BYTES
  ) {
    // Truncated all the way to zero tabs and it *still* doesn't fit — the envelope
    // overhead alone exceeds the cap. Vanishingly unlikely, but report it rather than
    // silently sending an oversized message the hub will reject.
    await setLiveSyncError('snapshot too large to send, even with zero tabs');
    return;
  }

  socket.send(JSON.stringify(envelope));
  await setLastSnapshotHash(hash);
  await setLiveSyncError(null);
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
        if (item.envelope.kind === 'handoff') {
          const handoff = payload as HandoffPayload;
          await addPendingHandoff({
            id: item.id,
            url: handoff.url,
            title: handoff.title,
          });
        }
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
  // Never open a received URL here (CLAUDE.md constraint 10) — only store it.
  // The popup opens it, only in direct response to the human clicking "Open".
  if (frame.envelope.kind === 'handoff') {
    const handoff = payload as HandoffPayload;
    await addPendingHandoff({
      id: frame.id,
      url: handoff.url,
      title: handoff.title,
    });
  }
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
    browser.runtime.onStartup.addListener(() => void connect().catch(() => {}));
    browser.runtime.onInstalled.addListener(
      () => void connect().catch(() => {}),
    );
    browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
    browser.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === RECONNECT_ALARM) {
        void connect().catch(() => {});
        void drainInbox();
        void publishPresence();
      }
    });

    browser.runtime.onMessage.addListener(
      (
        message: {
          type?: string;
          passphrase?: string;
          hubBaseUrl?: string;
          pairingPayload?: string;
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
        return false;
      },
    );

    void connect().catch(() => {});
  },
});
