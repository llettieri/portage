import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('hub routing (smoke)', () => {
  it('404s for a path with no room id', async () => {
    const res = await SELF.fetch('https://example.com/room/');
    expect(res.status).toBe(404);
  });

  it('426s a non-websocket request to a room', async () => {
    const res = await SELF.fetch('https://example.com/room/test-room-1');
    expect(res.status).toBe(426);
  });

  it('opens a websocket for an upgrade request with a valid token', async () => {
    const issueRes = await SELF.fetch('https://example.com/room/test-room-1/pair/issue', {
      method: 'POST',
      body: JSON.stringify({ device: 'device-a' }),
    });
    const { deviceToken } = (await issueRes.json()) as { deviceToken: string };

    const res = await SELF.fetch(`https://example.com/room/test-room-1?device=device-a&token=${deviceToken}`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
    res.webSocket?.accept();
    res.webSocket?.close();
  });
});
