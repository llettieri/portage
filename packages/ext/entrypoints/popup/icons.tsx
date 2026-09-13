interface IconProps {
  size?: number;
}

export function SendIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 8h11M8 3l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlusIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function CopyIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 10.5V3.9A1.4 1.4 0 0 1 4.9 2.5h6.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EyeIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function EyeOffIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 2.5l11.5 11.5M6.6 6.7A2 2 0 0 0 9.3 9.4M4.2 4.6C2.5 5.7 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.1 0 2.1-.35 2.95-.87M8.9 3.6C8.6 3.55 8.3 3.5 8 3.5c-.4 0-.78.04-1.15.1m4.55 1.6C12.7 6 13.6 7.15 14.5 8c0 0-.62 1.13-1.7 2.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DismissIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function TrailGlyph({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3" cy="12" r="2" fill="currentColor" />
      <circle cx="13" cy="4" r="2" fill="currentColor" />
      <path d="M4.6 10.6 11.4 5.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="1.6 2.2" />
    </svg>
  );
}
