interface StatusDotProps {
  connected: boolean;
}

export function StatusDot({ connected }: StatusDotProps) {
  return (
    <div className="status">
      <span className={`dot${connected ? ' connected' : ''}`} />
      <span>{connected ? 'connected' : 'disconnected'}</span>
    </div>
  );
}
