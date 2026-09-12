import type { PendingHandoff } from '../../lib/state.js';

interface ReceivedListProps {
  items: PendingHandoff[];
  onOpen: (item: PendingHandoff) => void;
}

export function ReceivedList({ items, onOpen }: ReceivedListProps) {
  return (
    <div>
      {items.map((item, index) => (
        <div className="received" key={item.id ?? `${item.url}-${index}`}>
          <div className="received-title">{item.title || item.url}</div>
          <div className="received-url">{item.url}</div>
          <button onClick={() => onOpen(item)}>Open</button>
        </div>
      ))}
    </div>
  );
}
