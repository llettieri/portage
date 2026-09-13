import { TrailGlyph } from '@/entrypoints/popup/icons.tsx';

interface HeaderProps {
  connected: boolean;
  showStatus: boolean;
}

export function Header({ connected, showStatus }: HeaderProps) {
  return (
    <header className="header">
      <div className="wordmark">
        <span className="trail-glyph">
          <TrailGlyph />
        </span>
        Portage
      </div>
      {showStatus && (
        <div className={`status-pill${connected ? ' is-connected' : ''}`} role="status">
          <span className="status-dot" />
          {connected ? 'Connected' : 'Offline'}
        </div>
      )}
    </header>
  );
}
