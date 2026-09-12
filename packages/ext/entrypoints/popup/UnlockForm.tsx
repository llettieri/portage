import { useRef } from 'react';

interface UnlockFormProps {
  visible: boolean;
  onUnlock: (passphrase: string) => void;
}

export function UnlockForm({ visible, onUnlock }: UnlockFormProps) {
  const passphraseRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ display: visible ? 'block' : 'none' }}>
      <input ref={passphraseRef} type="password" placeholder="Re-enter shared passphrase" />
      <button
        onClick={() => {
          onUnlock(passphraseRef.current!.value);
          passphraseRef.current!.value = '';
        }}
      >
        Unlock
      </button>
    </div>
  );
}
