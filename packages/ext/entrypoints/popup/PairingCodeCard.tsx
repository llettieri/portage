import { useState } from 'react';
import {
  CheckIcon,
  CopyIcon,
  DismissIcon,
} from '@/entrypoints/popup/icons.tsx';

interface PairingCodeCardProps {
  value: string;
  onDismiss: () => void;
}

export function PairingCodeCard({ value, onDismiss }: PairingCodeCardProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="code-card">
      <div className="code-card-head">
        <span className="eyebrow">Pairing code</span>
        <button
          type="button"
          className="btn-ghost"
          aria-label="Dismiss pairing code"
          onClick={onDismiss}
        >
          <DismissIcon />
        </button>
      </div>
      <div className="code-block">{value}</div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => void handleCopy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy code'}
      </button>
      <span className="code-caption">
        Paste this on the new device to join this room. It works once.
      </span>
    </div>
  );
}
