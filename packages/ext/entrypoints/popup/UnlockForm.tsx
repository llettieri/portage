import { useId, useRef, useState } from 'react';
import { EyeIcon, EyeOffIcon } from '@/entrypoints/popup/icons.tsx';

interface UnlockFormProps {
  onUnlock: (passphrase: string) => void;
}

export function UnlockForm({ onUnlock }: UnlockFormProps) {
  const passphraseRef = useRef<HTMLInputElement>(null);
  const [reveal, setReveal] = useState(false);
  const fieldId = useId();

  function submit(): void {
    onUnlock(passphraseRef.current!.value);
    passphraseRef.current!.value = '';
  }

  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={fieldId}>This room is locked</label>
      <div className="password-row">
        <input
          id={fieldId}
          ref={passphraseRef}
          className="input"
          type={reveal ? 'text' : 'password'}
          placeholder="Shared passphrase"
          autoFocus
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
      <button type="submit" className="btn btn-primary">
        Unlock
      </button>
    </form>
  );
}
