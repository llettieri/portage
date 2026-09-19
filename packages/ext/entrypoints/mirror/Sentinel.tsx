import { useEffect, useState, type ReactNode } from 'react';
import { MAX_MIRROR_TABS_PER_DEVICE } from 'protocol';
import { isHttpUrl } from '@/lib/liveSync.ts';
import { getRemoteSnapshots, type RemoteSnapshot } from '@/lib/state.ts';

export function Sentinel(): ReactNode {
  const [snapshots, setSnapshots] = useState<Record<string, RemoteSnapshot>>(
    {},
  );

  useEffect(() => {
    void getRemoteSnapshots().then(setSnapshots);
    function onStorageChanged(
      changes: Record<string, unknown>,
      area: string,
    ): void {
      if (area === 'local' && 'remoteSnapshots' in changes) {
        void getRemoteSnapshots().then(setSnapshots);
      }
    }
    browser.storage.onChanged.addListener(onStorageChanged);
    return (): void =>
      browser.storage.onChanged.removeListener(onStorageChanged);
  }, []);

  const devices = Object.entries(snapshots);

  return (
    <div className="sentinel">
      <h1>Portage — live sync</h1>
      {devices.length === 0 && <p>No remote devices yet.</p>}
      {devices.map(([deviceId, snapshot]) => {
        // Dedupe by URL first — computeDesiredMirrors (packages/ext/lib/liveSync.ts)
        // dedupes before applying the cap, so slicing the raw (possibly
        // duplicate-containing) list here would show a
        // tab as "mirrored" that has no mirror tab, or hide one that does.
        const deduped = snapshot.tabs.filter(
          (tab, i, all) => all.findIndex((t) => t.url === tab.url) === i,
        );
        const shown = deduped.slice(0, MAX_MIRROR_TABS_PER_DEVICE);
        const overflow = deduped.slice(MAX_MIRROR_TABS_PER_DEVICE);
        return (
          <section key={deviceId} className="sentinel-device">
            <h2>{deviceId}</h2>
            {snapshot.truncated && (
              <p className="sentinel-warning">
                sender dropped some tabs to fit — this list may be incomplete
              </p>
            )}
            {overflow.length > 0 && (
              <p className="sentinel-note">
                showing {shown.length} of {deduped.length}
              </p>
            )}
            <ul>
              {shown.map((tab, i) => (
                <li key={`${deviceId}-shown-${i}-${tab.url}`}>
                  {tab.title || tab.url}
                </li>
              ))}
            </ul>
            {overflow.length > 0 && (
              <ul>
                {overflow.map((tab, i) => (
                  <li key={`${deviceId}-overflow-${i}-${tab.url}`}>
                    {isHttpUrl(tab.url) ? (
                      <a href={tab.url} target="_blank" rel="noreferrer">
                        {tab.title || tab.url}
                      </a>
                    ) : (
                      tab.title || tab.url
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
