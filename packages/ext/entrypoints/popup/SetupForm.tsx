import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getSetupDraft, setSetupDraft } from '@/lib/state.ts';
import { EyeIcon, EyeOffIcon } from '@/entrypoints/popup/icons.tsx';

interface SetupFormProps {
  onCreate: (passphrase: string, hubBaseUrl: string) => void;
  onJoin: (passphrase: string, pairingPayload: string) => void;
}

export function SetupForm({ onCreate, onJoin }: SetupFormProps): ReactNode {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const passphraseRef = useRef<HTMLInputElement>(null);
  const [reveal, setReveal] = useState(false);
  const [host, setHost] = useState('');
  const [useTls, setUseTls] = useState(false);
  const [pairingPayloadIn, setPairingPayloadIn] = useState('');
  const passphraseFieldId = useId();

  useEffect(() => {
    void getSetupDraft().then((draft) => {
      setHost(draft.host);
      setUseTls(draft.useTls);
      setPairingPayloadIn(draft.pairingPayloadIn);
    });
  }, []);

  function saveDraft(next: {
    host: string;
    useTls: boolean;
    pairingPayloadIn: string;
  }): void {
    void setSetupDraft(next);
  }

  return (
    <div className="field">
      <div className="segmented" role="tablist" aria-label="Room setup mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'create'}
          className={mode === 'create' ? 'is-active' : ''}
          onClick={() => setMode('create')}
        >
          Create room
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'join'}
          className={mode === 'join' ? 'is-active' : ''}
          onClick={() => setMode('join')}
        >
          Join room
        </button>
      </div>

      <div className="field">
        <label htmlFor={passphraseFieldId}>Shared passphrase</label>
        <div className="password-row">
          <input
            id={passphraseFieldId}
            ref={passphraseRef}
            className="input"
            type={reveal ? 'text' : 'password'}
            placeholder="Only devices in this room know it"
          />
          <button
            type="button"
            className="reveal-toggle"
            aria-label={reveal ? 'Hide passphrase' : 'Show passphrase'}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      {mode === 'create' ? (
        <>
          <div className="field">
            <label htmlFor="host">Hub address</label>
            <input
              id="host"
              className="input"
              type="text"
              placeholder="127.0.0.1:8787"
              value={host}
              onChange={(e) => {
                const next = e.target.value;
                setHost(next);
                saveDraft({ host: next, useTls, pairingPayloadIn });
              }}
            />
          </div>
          <label className="toggle-row">
            <span className="switch">
              <input
                type="checkbox"
                checked={useTls}
                onChange={(e) => {
                  const next = e.target.checked;
                  setUseTls(next);
                  saveDraft({ host, useTls: next, pairingPayloadIn });
                }}
              />
              <span className="switch-track" />
            </span>
            Use TLS (wss / https)
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              onCreate(
                passphraseRef.current!.value,
                `${useTls ? 'wss' : 'ws'}://${host.trim()}`,
              )
            }
          >
            Create a new room
          </button>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="pairing-in">Pairing code</label>
            <textarea
              id="pairing-in"
              className="input"
              value={pairingPayloadIn}
              onChange={(e) => {
                const next = e.target.value;
                setPairingPayloadIn(next);
                saveDraft({ host, useTls, pairingPayloadIn: next });
              }}
              placeholder="Paste the code from a device already in the room"
              rows={3}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              onJoin(passphraseRef.current!.value, pairingPayloadIn.trim())
            }
          >
            Join with this code
          </button>
        </>
      )}
    </div>
  );
}
