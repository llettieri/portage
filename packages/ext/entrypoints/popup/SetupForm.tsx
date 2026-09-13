import { useEffect, useRef, useState } from 'react';
import { getSetupDraft, setSetupDraft } from '../../lib/state.js';

interface SetupFormProps {
  visible: boolean;
  pairingPayloadOut: string | null;
  onCreate: (passphrase: string, hubBaseUrl: string) => void;
  onJoin: (passphrase: string, pairingPayload: string) => void;
}

export function SetupForm({ visible, pairingPayloadOut, onCreate, onJoin }: SetupFormProps) {
  const passphraseRef = useRef<HTMLInputElement>(null);
  const [host, setHost] = useState('');
  const [useTls, setUseTls] = useState(false);
  const [pairingPayloadIn, setPairingPayloadIn] = useState('');

  useEffect(() => {
    void getSetupDraft().then((draft) => {
      setHost(draft.host);
      setUseTls(draft.useTls);
      setPairingPayloadIn(draft.pairingPayloadIn);
    });
  }, []);

  function saveDraft(next: { host: string; useTls: boolean; pairingPayloadIn: string }): void {
    void setSetupDraft(next);
  }

  return (
    <>
      <div style={{ display: visible ? 'block' : 'none' }}>
        <input ref={passphraseRef} type="password" placeholder="Shared passphrase" />
        <input
          type="text"
          placeholder="127.0.0.1:8787 (new room only)"
          value={host}
          onChange={(e) => {
            const next = e.target.value;
            setHost(next);
            saveDraft({ host: next, useTls, pairingPayloadIn });
          }}
        />
        <label>
          <input
            type="checkbox"
            checked={useTls}
            onChange={(e) => {
              const next = e.target.checked;
              setUseTls(next);
              saveDraft({ host, useTls: next, pairingPayloadIn });
            }}
          />
          Use TLS (wss/https)
        </label>
        <button
          onClick={() => onCreate(passphraseRef.current!.value, `${useTls ? 'wss' : 'ws'}://${host.trim()}`)}
        >
          Create a new room
        </button>
        <textarea
          value={pairingPayloadIn}
          onChange={(e) => {
            const next = e.target.value;
            setPairingPayloadIn(next);
            saveDraft({ host, useTls, pairingPayloadIn: next });
          }}
          placeholder="Paste pairing payload from the other device"
          rows={3}
        />
        <button onClick={() => onJoin(passphraseRef.current!.value, pairingPayloadIn.trim())}>
          Join with pasted payload
        </button>
      </div>
      <textarea
        readOnly
        rows={3}
        value={pairingPayloadOut ?? ''}
        style={{ display: pairingPayloadOut ? 'block' : 'none' }}
      />
    </>
  );
}
