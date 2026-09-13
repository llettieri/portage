import type { ReactNode } from 'react';
import type { PendingHandoff } from '@/lib/state.ts';
import { DismissIcon } from '@/entrypoints/popup/icons.tsx';

interface ReceivedListProps {
  items: PendingHandoff[];
  onOpen: (item: PendingHandoff) => void;
  onRemove: (item: PendingHandoff) => void;
}

function initialFor(item: PendingHandoff): string {
  const source = item.title || item.url;
  const stripped = source.replace(/^https?:\/\/(www\.)?/, '');
  return stripped.charAt(0).toUpperCase() || '?';
}

function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ReceivedList({
  items,
  onOpen,
  onRemove,
}: ReceivedListProps): ReactNode {
  return (
    <div className="field">
      <span className="eyebrow">
        Received{items.length > 0 ? ` · ${items.length}` : ''}
      </span>
      {items.length === 0 ? (
        <div className="empty-state">
          Tabs sent to this device will show up here.
        </div>
      ) : (
        <div className="received-list">
          {items.map((item, index) => (
            <div
              className="received-item"
              key={item.id ?? `${item.url}-${index}`}
            >
              <span className="received-favicon" aria-hidden="true">
                {initialFor(item)}
              </span>
              <div className="received-body">
                <div className="received-title">
                  {item.title || hostFor(item.url)}
                </div>
                <div className="received-url">{hostFor(item.url)}</div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: 'auto' }}
                onClick={() => onOpen(item)}
              >
                Open
              </button>
              <button
                type="button"
                className="btn-ghost"
                aria-label={`Remove "${item.title || hostFor(item.url)}" from received tabs`}
                onClick={() => onRemove(item)}
              >
                <DismissIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
