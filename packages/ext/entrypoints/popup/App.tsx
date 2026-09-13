import { useEffect, useState, type ReactNode } from 'react';
import {
  getDecryptError,
  getPendingHandoffs,
  getRoomConfig,
  removePendingHandoff,
  type PendingHandoff,
} from '@/lib/state.ts';
import { Banner } from '@/entrypoints/popup/Banner.tsx';
import { Header } from '@/entrypoints/popup/Header.tsx';
import { Home } from '@/entrypoints/popup/Home.tsx';
import { PairingCodeCard } from '@/entrypoints/popup/PairingCodeCard.tsx';
import { SetupForm } from '@/entrypoints/popup/SetupForm.tsx';
import { UnlockForm } from '@/entrypoints/popup/UnlockForm.tsx';

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

export function App(): ReactNode {
  const [view, setView] = useState<ViewState>(initialView);
  const [pairingPayloadOut, setPairingPayloadOut] = useState<string | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const [
      hasDecryptError,
      pending,
      roomConfig,
      unlockStatus,
      connectionStatus,
    ] = await Promise.all([
      getDecryptError(),
      getPendingHandoffs(),
      getRoomConfig(),
      (
        browser.runtime.sendMessage({ type: 'is-unlocked' }) as Promise<{
          unlocked: boolean;
        }>
      ).catch(() => ({
        unlocked: false,
      })),
      (
        browser.runtime.sendMessage({ type: 'is-connected' }) as Promise<{
          connected: boolean;
        }>
      ).catch(() => ({
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

    function onStorageChanged(
      changes: Record<string, unknown>,
      area: string,
    ): void {
      if (
        area === 'local' &&
        ('connected' in changes ||
          'decryptError' in changes ||
          'pendingHandoffs' in changes ||
          'roomConfig' in changes)
      ) {
        void refresh();
      }
    }
    browser.storage.onChanged.addListener(onStorageChanged);
    return (): void =>
      browser.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  async function handleCreate(
    passphrase: string,
    hubBaseUrl: string,
  ): Promise<void> {
    setActionError(null);
    const response = (await browser.runtime.sendMessage({
      type: 'setup-create',
      passphrase,
      hubBaseUrl,
    })) as {
      ok: boolean;
      pairingPayloadOut?: string;
      error?: string;
    };
    if (response?.ok && response.pairingPayloadOut) {
      setPairingPayloadOut(response.pairingPayloadOut);
    } else {
      setActionError(
        `Could not create room: ${response?.error ?? 'unknown error'}`,
      );
    }
    await refresh();
  }

  async function handleJoin(
    passphrase: string,
    pairingPayload: string,
  ): Promise<void> {
    setActionError(null);
    const response = (await browser.runtime.sendMessage({
      type: 'setup-join',
      passphrase,
      pairingPayload,
    })) as {
      ok: boolean;
      error?: string;
    };
    if (!response?.ok)
      setActionError(
        `Could not join room: ${response?.error ?? 'unknown error'}`,
      );
    await refresh();
  }

  async function handleInvite(): Promise<void> {
    setActionError(null);
    const response = (await browser.runtime.sendMessage({
      type: 'invite-device',
    })) as {
      ok: boolean;
      pairingPayloadOut?: string;
      error?: string;
    };
    if (response?.ok && response.pairingPayloadOut) {
      setPairingPayloadOut(response.pairingPayloadOut);
    } else {
      setActionError(
        `Could not create invite: ${response?.error ?? 'unknown error'}`,
      );
    }
  }

  async function handleSendTab(): Promise<void> {
    setActionError(null);
    const response = (await browser.runtime.sendMessage({
      type: 'send-tab',
    })) as { ok: boolean; error?: string };
    if (!response?.ok) {
      setActionError(
        `Could not send tab: ${response?.error ?? 'unknown error'}`,
      );
      throw new Error(response?.error ?? 'send failed');
    }
  }

  async function handleForgetRoom(): Promise<void> {
    setActionError(null);
    setPairingPayloadOut(null);
    await browser.runtime.sendMessage({ type: 'forget-room' });
    await refresh();
  }

  async function handleUnlock(passphrase: string): Promise<void> {
    setActionError(null);
    const response = (await browser.runtime.sendMessage({
      type: 'unlock',
      passphrase,
    })) as {
      ok: boolean;
      error?: string;
    };
    if (!response?.ok)
      setActionError(`Could not unlock: ${response?.error ?? 'unknown error'}`);
    await refresh();
  }

  async function handleOpen(item: PendingHandoff): Promise<void> {
    await browser.tabs.create({ url: item.url });
    await removePendingHandoff(item);
    await refresh();
  }

  async function handleRemove(item: PendingHandoff): Promise<void> {
    await removePendingHandoff(item);
    await refresh();
  }

  const stage: 'setup' | 'locked' | 'home' = !view.roomConfigured
    ? 'setup'
    : !view.unlocked
      ? 'locked'
      : 'home';

  return (
    <div className="popup">
      <Header connected={view.connected} showStatus={stage === 'home'} />
      <div className="body">
        {view.hasDecryptError && (
          <Banner tone="error">
            Couldn't decrypt a received message — check your passphrase.
          </Banner>
        )}
        {actionError && (
          <Banner tone="error" onDismiss={() => setActionError(null)}>
            {actionError}
          </Banner>
        )}
        {pairingPayloadOut && (
          <PairingCodeCard
            value={pairingPayloadOut}
            onDismiss={() => setPairingPayloadOut(null)}
          />
        )}

        {stage === 'setup' && (
          <SetupForm
            onCreate={(p, h) => void handleCreate(p, h)}
            onJoin={(p, payload) => void handleJoin(p, payload)}
          />
        )}
        {stage === 'locked' && (
          <UnlockForm onUnlock={(p) => void handleUnlock(p)} />
        )}
        {stage === 'home' && (
          <Home
            pending={view.pending}
            onSendTab={handleSendTab}
            onInvite={() => void handleInvite()}
            onForget={() => void handleForgetRoom()}
            onOpen={(item) => void handleOpen(item)}
            onRemove={(item) => void handleRemove(item)}
          />
        )}
      </div>
    </div>
  );
}
