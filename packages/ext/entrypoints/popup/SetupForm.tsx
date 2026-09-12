import { useRef } from 'react';

interface SetupFormProps {
  visible: boolean;
  pairingPayloadOut: string | null;
  onCreate: (passphrase: string, hubBaseUrl: string) => void;
  onJoin: (passphrase: string, pairingPayload: string) => void;
}

export function SetupForm({ visible, pairingPayloadOut, onCreate, onJoin }: SetupFormProps) {
  const passphraseRef = useRef<HTMLInputElement>(null);
  const hubBaseUrlRef = useRef<HTMLInputElement>(null);
  const pairingPayloadInRef = useRef<HTMLTextAreaElement>(null);

  return (
    <>
      <div style={{ display: visible ? 'block' : 'none' }}>
        <input ref={passphraseRef} type="password" placeholder="Shared passphrase" />
        <input ref={hubBaseUrlRef} type="text" placeholder="ws://127.0.0.1:8787 (new room only)" />
        <button onClick={() => onCreate(passphraseRef.current!.value, hubBaseUrlRef.current!.value.trim())}>
          Create a new room
        </button>
        <textarea ref={pairingPayloadInRef} placeholder="Paste pairing payload from the other device" rows={3} />
        <button onClick={() => onJoin(passphraseRef.current!.value, pairingPayloadInRef.current!.value.trim())}>
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
