import type { ReactNode } from 'react';
import { DismissIcon } from '@/entrypoints/popup/icons.tsx';

interface BannerProps {
  tone: 'error';
  children: ReactNode;
  onDismiss?: () => void;
}

export function Banner({ tone, children, onDismiss }: BannerProps) {
  return (
    <div className={`banner banner-${tone}`} role="alert">
      <span className="banner-text">{children}</span>
      {onDismiss && (
        <button type="button" className="banner-dismiss" aria-label="Dismiss" onClick={onDismiss}>
          <DismissIcon />
        </button>
      )}
    </div>
  );
}
