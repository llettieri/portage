import { useState, type ReactNode } from 'react';
import { MAX_MIRROR_TABS_PER_DEVICE } from 'protocol';
import type { PendingHandoff, RemoteSnapshot } from '@/lib/state.ts';
import { CheckIcon, PlusIcon, SendIcon } from '@/entrypoints/popup/icons.tsx';
import { ReceivedList } from '@/entrypoints/popup/ReceivedList.tsx';

interface HomeProps {
  pending: PendingHandoff[];
  onSendTab: () => Promise<void>;
  onInvite: () => void;
  onForget: () => void;
  onOpen: (item: PendingHandoff) => void;
  onRemove: (item: PendingHandoff) => void;
  liveSync: boolean;
  liveSyncError: string | null;
  remoteSnapshots: Record<string, RemoteSnapshot>;
  onSetLiveSync: (value: boolean) => void;
}

type SendPhase = 'idle' | 'sending' | 'sent';

export function Home({
  pending,
  onSendTab,
  onInvite,
  onForget,
  onOpen,
  onRemove,
  liveSync,
  liveSyncError,
  remoteSnapshots,
  onSetLiveSync,
}: HomeProps): ReactNode {
  const [sendPhase, setSendPhase] = useState<SendPhase>('idle');
  const [confirmingForget, setConfirmingForget] = useState(false);

  async function handleSend(): Promise<void> {
    if (sendPhase !== 'idle') return;
    setSendPhase('sending');
    try {
      await onSendTab();
      setSendPhase('sent');
      setTimeout(() => setSendPhase('idle'), 1400);
    } catch {
      setSendPhase('idle');
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={sendPhase === 'sending'}
        onClick={() => void handleSend()}
      >
        {sendPhase === 'idle' && (
          <>
            <SendIcon /> Send current tab
          </>
        )}
        {sendPhase === 'sending' && (
          <span className="send-trail">
            <span>Sending</span>
            <span className="send-trail-line" />
          </span>
        )}
        {sendPhase === 'sent' && (
          <>
            <CheckIcon /> Sent
          </>
        )}
      </button>

      <ReceivedList items={pending} onOpen={onOpen} onRemove={onRemove} />

      <div className="field">
        <span className="eyebrow">Live sync</span>
        <label className="devices-row">
          <input
            type="checkbox"
            checked={liveSync}
            onChange={(e) => onSetLiveSync(e.target.checked)}
          />
          <span>Mirror open tabs across devices</span>
        </label>
        {liveSyncError && <p className="banner-error">{liveSyncError}</p>}
        {liveSync && Object.keys(remoteSnapshots).length > 0 && (
          <ul className="live-sync-devices">
            {Object.entries(remoteSnapshots).map(([deviceId, snapshot]) => (
              <li key={deviceId}>
                {deviceId.slice(0, 8)} —{' '}
                {Math.min(snapshot.tabs.length, MAX_MIRROR_TABS_PER_DEVICE)} of{' '}
                {snapshot.tabs.length} mirrored
                {snapshot.truncated ? ', truncated' : ''}, last seen{' '}
                {new Date(snapshot.receivedAt).toLocaleTimeString()}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="field">
        <span className="eyebrow">Devices</span>
        <div className="devices-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onInvite}
          >
            <PlusIcon /> Invite another device
          </button>
        </div>
        {confirmingForget ? (
          <div className="confirm-row">
            <span>
              Forget this room? You'll need the passphrase again to rejoin.
            </span>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmingForget(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: 'var(--pg-danger)' }}
                onClick={() => {
                  setConfirmingForget(false);
                  onForget();
                }}
              >
                Forget
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn-danger-text"
            onClick={() => setConfirmingForget(true)}
          >
            Forget this room
          </button>
        )}
      </div>
    </>
  );
}
