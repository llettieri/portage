import { useEffect, useState } from 'react';
import { getDecryptError, getPendingHandoffs, getRoomConfig, removePendingHandoff, type PendingHandoff } from '../../lib/state.js';
import { ReceivedList } from './ReceivedList.js';
import { SetupForm } from './SetupForm.js';
import { StatusDot } from './StatusDot.js';
import { UnlockForm } from './UnlockForm.js';

interface ViewState {
  connected: boolean;
  hasDecryptError: boolean;
  roomConfigured: boolean;
  unlocked: boolean;
  pending: PendingHandoff[];
}

const initialView: ViewState = {
  connected: false,
  hasDecryptError: false,
  roomConfigured: false,
  unlocked: false,
  pending: [],
};

export function App() {
  const [view, setView] = useState<ViewState>(initialView);
  const [pairingPayloadOut, setPairingPayloadOut] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [hasDecryptError, pending, roomConfig, unlockStatus, connectionStatus] = await Promise.all([
      getDecryptError(),
      getPendingHandoffs(),
      getRoomConfig(),
      (browser.runtime.sendMessage({ type: 'is-unlocked' }) as Promise<{ unlocked: boolean }>).catch(() => ({
        unlocked: false,
      })),
      (browser.runtime.sendMessage({ type: 'is-connected' }) as Promise<{ connected: boolean }>).catch(() => ({
        connected: false,
      })),
    ]);
    setView({
      connected: connectionStatus?.connected ?? false,
      hasDecryptError,
      roomConfigured: roomConfig !== null,
      unlocked: unlockStatus?.unlocked ?? false,
      pending,
    });
  }

  useEffect(() => {
    void browser.runtime.sendMessage({ type: 'drain' }).then(() => refresh());

    function onStorageChanged(changes: Record<string, unknown>, area: string): void {
      if (
        area === 'local' &&
        ('connected' in changes || 'decryptError' in changes || 'pendingHandoffs' in changes || 'roomConfig' in changes)
      ) {
        void refresh();
      }
    }
    browser.storage.onChanged.addListener(onStorageChanged);
    return () => browser.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  async function handleCreate(passphrase: string, hubBaseUrl: string): Promise<void> {
    setActionError(null);
    const response = (await browser.runtime.sendMessage({ type: 'setup-create', passphrase, hubBaseUrl })) as {
      ok: boolean;
      pairingPayloadOut?: string;
      error?: string;
    };
    if (response?.ok && response.pairingPayloadOut) {
      setPairingPayloadOut(response.pairingPayloadOut);
    } else {
      setActionError(`Could not create room: ${response?.error ?? 'unknown error'}`);
    }
    await refresh();
  }

  async function handleJoin(passphrase: string, pairingPayload: string): Promise<void> {
    setActionError(null);
    const response = (await browser.runtime.sendMessage({ type: 'setup-join', passphrase, pairingPayload })) as {
      ok: boolean;
      error?: string;
    };
    if (!response?.ok) setActionError(`Could not join room: ${response?.error ?? 'unknown error'}`);
    await refresh();
  }

  async function handleSendTab(): Promise<void> {
    setActionError(null);
    const response = (await browser.runtime.sendMessage({ type: 'send-tab' })) as { ok: boolean; error?: string };
    if (!response?.ok) setActionError(`Could not send tab: ${response?.error ?? 'unknown error'}`);
  }

  async function handleForgetRoom(): Promise<void> {
    setActionError(null);
    await browser.runtime.sendMessage({ type: 'forget-room' });
    await refresh();
  }

  async function handleUnlock(passphrase: string): Promise<void> {
    setActionError(null);
    const response = (await browser.runtime.sendMessage({ type: 'unlock', passphrase })) as {
      ok: boolean;
      error?: string;
    };
    if (!response?.ok) setActionError(`Could not unlock: ${response?.error ?? 'unknown error'}`);
    await refresh();
  }

  async function handleOpen(item: PendingHandoff): Promise<void> {
    await browser.tabs.create({ url: item.url });
    await removePendingHandoff(item);
    await refresh();
  }

  return (
    <div>
      <StatusDot connected={view.connected} />
      <div style={{ display: view.hasDecryptError ? 'block' : 'none', color: '#c0392b', fontWeight: 'bold', marginBottom: 8 }}>
        Couldn't decrypt a received message — check your passphrase.
      </div>
      {actionError && (
        <div style={{ color: '#c0392b', fontWeight: 'bold', marginBottom: 8 }}>{actionError}</div>
      )}
      <UnlockForm visible={view.roomConfigured && !view.unlocked} onUnlock={(p) => void handleUnlock(p)} />
      <SetupForm
        visible={!view.roomConfigured}
        pairingPayloadOut={pairingPayloadOut}
        onCreate={(p, h) => void handleCreate(p, h)}
        onJoin={(p, payload) => void handleJoin(p, payload)}
      />
      <button
        style={{ display: view.roomConfigured && view.unlocked ? 'block' : 'none' }}
        onClick={() => void handleSendTab()}
      >
        Send current tab
      </button>
      <button style={{ display: view.roomConfigured ? 'block' : 'none' }} onClick={() => void handleForgetRoom()}>
        Forget this room
      </button>
      <ReceivedList items={view.pending} onOpen={(item) => void handleOpen(item)} />
    </div>
  );
}
