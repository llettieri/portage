import { useEffect, useState, type ReactNode } from 'react';
import { isHttpUrl } from '@/lib/liveSync.ts';

export function Mirror(): ReactNode {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const url = params.get('u') ?? '';
  const title = params.get('t') ?? '';

  useEffect(() => {
    document.title = title || url || 'Portage — mirrored tab';
  }, [title, url]);

  useEffect(() => {
    function navigateIfVisible(): void {
      if (document.visibilityState !== 'visible') return;
      // Defense in depth, independent of the sender-side filter (spec §4.4): refuse to
      // navigate to anything that isn't http(s), even if it somehow arrived here.
      if (!isHttpUrl(url)) return;
      window.location.replace(url);
    }
    navigateIfVisible();
    document.addEventListener('visibilitychange', navigateIfVisible);
    return (): void =>
      document.removeEventListener('visibilitychange', navigateIfVisible);
  }, [url]);

  return (
    <div className="mirror-placeholder">
      <p className="mirror-title">{title || '(untitled)'}</p>
      <p className="mirror-url">{url}</p>
    </div>
  );
}
