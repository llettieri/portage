export function toHttpBase(hubUrl: string): string {
  const url = new URL(hubUrl);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    // A hub URL that isn't ws:/wss: (e.g. a user mistakenly pasting an https:// URL)
    // must not silently fall through to plain http: — that would send the bearer
    // token in cleartext instead of failing loudly.
    throw new Error(`hub URL must use ws:// or wss:// (got "${url.protocol}")`);
  }
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}

export function buildConnectUrl(
  hubUrl: string,
  deviceId: string,
  token: string,
): string {
  const url = new URL(hubUrl);
  url.searchParams.set('device', deviceId);
  url.searchParams.set('token', token);
  return url.toString();
}
