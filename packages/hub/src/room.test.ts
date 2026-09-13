import { describe, expect, it } from 'vitest';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import {
  MAX_PAYLOAD_BYTES,
  MAX_QUEUE_DEPTH_PER_DEVICE,
  RATE_LIMIT_MAX_MESSAGES,
} from './limits.js';

async function openAuthorizedSocket(
  room: string,
  device: string,
  token: string,
): Promise<WebSocket> {
  const res = await SELF.fetch(
    `https://example.com/room/${room}?device=${device}&token=${token}`,
    {
      headers: { Upgrade: 'websocket' },
    },
  );
  const ws = res.webSocket;
  if (!ws) throw new Error('expected a websocket');
  ws.accept();
  return ws;
}

// `pair/issue`'s non-bootstrap auth (Task 11) checks that the bearer token belongs to
// the device named in the request body — i.e. an existing device re-asserts its own
// identity to mint a fresh code. The device that will actually consume the code (and
// needs no auth to do so) is named separately, in the `pair/consume` call. So inviting
// a new device takes two identities: the already-registered device vouching for itself
// (`caller`), and the new device being registered (`device`).
async function registerDevice(
  room: string,
  device: string,
  caller?: { asDevice: string; token: string },
): Promise<string> {
  const res = await SELF.fetch(`https://example.com/room/${room}/pair/issue`, {
    method: 'POST',
    headers: caller ? { Authorization: `Bearer ${caller.token}` } : {},
    body: JSON.stringify({ device: caller ? caller.asDevice : device }),
  });
  const body = (await res.json()) as { code: string; deviceToken?: string };
  if (body.deviceToken) return body.deviceToken;
  const consumeRes = await SELF.fetch(
    `https://example.com/room/${room}/pair/consume`,
    {
      method: 'POST',
      body: JSON.stringify({ code: body.code, device }),
    },
  );
  return ((await consumeRes.json()) as { deviceToken: string }).deviceToken;
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.addEventListener('message', (event) => resolve(event.data as string), {
      once: true,
    });
  });
}

describe('per-recipient routing', () => {
  it('delivers a message addressed to one device only to that device', async () => {
    const room = 'routing-test-1';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const tokenC = await registerDevice(room, 'device-c', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);
    const b = await openAuthorizedSocket(room, 'device-b', tokenB);
    const c = await openAuthorizedSocket(room, 'device-c', tokenC);

    const bReceived = nextMessage(b);
    let cReceived = false;
    c.addEventListener('message', () => {
      cReceived = true;
    });

    a.send(
      JSON.stringify({
        v: 1,
        room,
        device: 'device-a',
        to: 'device-b',
        kind: 'handoff',
        iv: 'x',
        ciphertext: 'y',
        ts: 1,
      }),
    );

    const message = await bReceived;
    expect(JSON.parse(message).envelope.to).toBe('device-b');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cReceived).toBe(false);

    a.close();
    b.close();
    c.close();
  });

  it('delivers a "to: all" message to every other connected device', async () => {
    const room = 'routing-test-2';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);
    const b = await openAuthorizedSocket(room, 'device-b', tokenB);

    const bReceived = nextMessage(b);
    a.send(
      JSON.stringify({
        v: 1,
        room,
        device: 'device-a',
        to: 'all',
        kind: 'presence',
        iv: 'x',
        ciphertext: 'y',
        ts: 1,
      }),
    );
    const message = await bReceived;
    expect(JSON.parse(message).envelope.to).toBe('all');

    a.close();
    b.close();
  });

  it('drops an envelope missing `to` instead of broadcasting to every socket', async () => {
    const room = 'routing-test-3';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const tokenC = await registerDevice(room, 'device-c', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);
    const b = await openAuthorizedSocket(room, 'device-b', tokenB);
    const c = await openAuthorizedSocket(room, 'device-c', tokenC);

    let received = false;
    b.addEventListener('message', () => {
      received = true;
    });
    c.addEventListener('message', () => {
      received = true;
    });

    a.send(
      JSON.stringify({
        v: 1,
        room,
        device: 'device-a',
        kind: 'handoff',
        iv: 'x',
        ciphertext: 'y',
        ts: 1,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toBe(false);

    a.close();
    b.close();
    c.close();
  });
});

describe('pairing', () => {
  it('bootstraps the first device with a token and a pairing code', async () => {
    const room = 'pairing-test-1';
    const res = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; deviceToken?: string };
    expect(typeof body.code).toBe('string');
    expect(typeof body.deviceToken).toBe('string');
  });

  it('lets a second device consume the code for its own token', async () => {
    const room = 'pairing-test-2';
    const issueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    const { code } = (await issueRes.json()) as { code: string };

    const consumeRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/consume`,
      {
        method: 'POST',
        body: JSON.stringify({ code, device: 'device-b' }),
      },
    );
    expect(consumeRes.status).toBe(200);
    const { deviceToken } = (await consumeRes.json()) as {
      deviceToken: string;
    };
    expect(typeof deviceToken).toBe('string');
  });

  it('rejects reusing a pairing code', async () => {
    const room = 'pairing-test-3';
    const issueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    const { code } = (await issueRes.json()) as { code: string };

    await SELF.fetch(`https://example.com/room/${room}/pair/consume`, {
      method: 'POST',
      body: JSON.stringify({ code, device: 'device-b' }),
    });
    const secondAttempt = await SELF.fetch(
      `https://example.com/room/${room}/pair/consume`,
      {
        method: 'POST',
        body: JSON.stringify({ code, device: 'device-c' }),
      },
    );
    expect(secondAttempt.status).toBe(403);
  });

  it('rejects an expired pairing code', async () => {
    const room = 'pairing-test-4';
    const issueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    const { code } = (await issueRes.json()) as { code: string };

    const id = env.ROOM.idFromName(room);
    const stub = env.ROOM.get(id);
    await runInDurableObject(
      stub,
      async (_instance: unknown, state: DurableObjectState) => {
        state.storage.sql.exec(
          'UPDATE pairing_codes SET expires_at = ? WHERE code = ?',
          Date.now() - 1_000,
          code,
        );
      },
    );

    const consumeRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/consume`,
      {
        method: 'POST',
        body: JSON.stringify({ code, device: 'device-b' }),
      },
    );
    expect(consumeRes.status).toBe(403);
  });

  it('rejects a non-bootstrap pair/issue with no token', async () => {
    const room = 'pairing-test-5';
    await SELF.fetch(`https://example.com/room/${room}/pair/issue`, {
      method: 'POST',
      body: JSON.stringify({ device: 'device-a' }),
    });
    const res = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    expect(res.status).toBe(401);
  });

  it('allows a non-bootstrap pair/issue with a valid token', async () => {
    const room = 'pairing-test-6';
    const issueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    const { deviceToken } = (await issueRes.json()) as { deviceToken: string };

    const secondIssue = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${deviceToken}` },
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    expect(secondIssue.status).toBe(200);
  });
});

describe('device revoke', () => {
  it('revokes a device so its token no longer authorizes pair/issue', async () => {
    const room = 'revoke-test-1';
    const issueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    const { deviceToken } = (await issueRes.json()) as { deviceToken: string };

    const revokeRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/revoke`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${deviceToken}` },
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    expect(revokeRes.status).toBe(200);

    const reissueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${deviceToken}` },
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    expect(reissueRes.status).toBe(401);
  });

  it('requires a valid token to revoke anyone', async () => {
    const room = 'revoke-test-2';
    await SELF.fetch(`https://example.com/room/${room}/pair/issue`, {
      method: 'POST',
      body: JSON.stringify({ device: 'device-a' }),
    });
    const res = await SELF.fetch(
      `https://example.com/room/${room}/pair/revoke`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects re-registering a revoked device id via a fresh pairing code', async () => {
    const room = 'revoke-test-3';
    const issueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    const { code: firstCode } = (await issueRes.json()) as { code: string };

    const consumeRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/consume`,
      {
        method: 'POST',
        body: JSON.stringify({ code: firstCode, device: 'device-b' }),
      },
    );
    const { deviceToken: tokenB } = (await consumeRes.json()) as {
      deviceToken: string;
    };

    await SELF.fetch(`https://example.com/room/${room}/pair/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ device: 'device-a' }),
    });

    const secondIssueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    const { code: secondCode } = (await secondIssueRes.json()) as {
      code: string;
    };

    const reregisterRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/consume`,
      {
        method: 'POST',
        body: JSON.stringify({ code: secondCode, device: 'device-a' }),
      },
    );
    expect(reregisterRes.status).toBe(409);
  });
});

describe('inbox queue', () => {
  it('queues a message for an offline device and returns it on drain', async () => {
    const room = 'inbox-test-1';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);

    a.send(
      JSON.stringify({
        v: 1,
        room,
        device: 'device-a',
        to: 'device-b',
        kind: 'handoff',
        iv: 'x',
        ciphertext: 'y',
        ts: 1,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const drainRes = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    const { items } = (await drainRes.json()) as {
      items: Array<{ id: string; envelope: unknown }>;
    };
    expect(items).toHaveLength(1);
    expect(typeof items[0]?.id).toBe('string');

    a.close();
  });

  it('keeps a queued item until it is explicitly acked, not merely delivered', async () => {
    const room = 'inbox-test-2';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);
    a.send(
      JSON.stringify({
        v: 1,
        room,
        device: 'device-a',
        to: 'device-b',
        kind: 'handoff',
        iv: 'x',
        ciphertext: 'y',
        ts: 1,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const firstDrain = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    const { items } = (await firstDrain.json()) as {
      items: Array<{ id: string }>;
    };
    expect(items).toHaveLength(1);

    const secondDrain = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    expect(
      ((await secondDrain.json()) as { items: unknown[] }).items,
    ).toHaveLength(1);

    await SELF.fetch(`https://example.com/room/${room}/inbox/ack`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ device: 'device-b', ids: [items[0]?.id ?? ''] }),
    });

    const thirdDrain = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    expect(
      ((await thirdDrain.json()) as { items: unknown[] }).items,
    ).toHaveLength(0);

    a.close();
  });

  it('does not let device-c drain a message addressed to device-b', async () => {
    const room = 'inbox-test-3';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenC = await registerDevice(room, 'device-c', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);
    a.send(
      JSON.stringify({
        v: 1,
        room,
        device: 'device-a',
        to: 'device-b',
        kind: 'handoff',
        iv: 'x',
        ciphertext: 'y',
        ts: 1,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const drainRes = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenC}` },
        body: JSON.stringify({ device: 'device-c' }),
      },
    );
    expect(
      ((await drainRes.json()) as { items: unknown[] }).items,
    ).toHaveLength(0);

    a.close();
  });

  it('expires queued items older than 30 days', async () => {
    const room = 'inbox-test-4';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);
    a.send(
      JSON.stringify({
        v: 1,
        room,
        device: 'device-a',
        to: 'device-b',
        kind: 'handoff',
        iv: 'x',
        ciphertext: 'y',
        ts: 1,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const id = env.ROOM.idFromName(room);
    const stub = env.ROOM.get(id);
    const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;
    await runInDurableObject(
      stub,
      async (_instance: unknown, state: DurableObjectState) => {
        state.storage.sql.exec(
          'UPDATE inbox SET created_at = ? WHERE to_device = ?',
          Date.now() - THIRTY_ONE_DAYS_MS,
          'device-b',
        );
      },
    );

    const drainRes = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    expect(
      ((await drainRes.json()) as { items: unknown[] }).items,
    ).toHaveLength(0);

    a.close();
  });

  it('queues a `to: all` broadcast for a registered device that is not currently connected', async () => {
    const room = 'inbox-test-5';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);
    // device-b is registered but never opens a socket here — it's "offline".

    a.send(
      JSON.stringify({
        v: 1,
        room,
        device: 'device-a',
        to: 'all',
        kind: 'presence',
        iv: 'x',
        ciphertext: 'y',
        ts: 1,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    const drainRes = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    const { items } = (await drainRes.json()) as {
      items: Array<{ id: string; envelope: { to: string } }>;
    };
    expect(items).toHaveLength(1);
    expect(items[0]?.envelope.to).toBe('all');

    a.close();
  });

  it('queues a `to: all` broadcast for an already-connected device too, so it is not lost if that device drops the live push while locked', async () => {
    const room = 'inbox-test-6';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);
    const b = await openAuthorizedSocket(room, 'device-b', tokenB);

    const bReceived = nextMessage(b);
    a.send(
      JSON.stringify({
        v: 1,
        room,
        device: 'device-a',
        to: 'all',
        kind: 'presence',
        iv: 'x',
        ciphertext: 'y',
        ts: 1,
      }),
    );
    await bReceived;

    const drainRes = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    const { items } = (await drainRes.json()) as {
      items: Array<{ id: string; envelope: { to: string } }>;
    };
    expect(items).toHaveLength(1);
    expect(items[0]?.envelope.to).toBe('all');

    a.close();
    b.close();
  });
});

describe('WebSocket upgrade auth', () => {
  it('rejects an upgrade with no token', async () => {
    const room = 'upgrade-auth-1';
    await SELF.fetch(`https://example.com/room/${room}/pair/issue`, {
      method: 'POST',
      body: JSON.stringify({ device: 'device-a' }),
    });
    const res = await SELF.fetch(
      `https://example.com/room/${room}?device=device-a`,
      {
        headers: { Upgrade: 'websocket' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects an upgrade with a revoked token', async () => {
    const room = 'upgrade-auth-2';
    const issueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    const { deviceToken } = (await issueRes.json()) as { deviceToken: string };
    await SELF.fetch(`https://example.com/room/${room}/pair/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify({ device: 'device-a' }),
    });

    const res = await SELF.fetch(
      `https://example.com/room/${room}?device=device-a&token=${deviceToken}`,
      {
        headers: { Upgrade: 'websocket' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('accepts an upgrade with a valid token', async () => {
    const room = 'upgrade-auth-3';
    const issueRes = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    const { deviceToken } = (await issueRes.json()) as { deviceToken: string };

    const res = await SELF.fetch(
      `https://example.com/room/${room}?device=device-a&token=${deviceToken}`,
      {
        headers: { Upgrade: 'websocket' },
      },
    );
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    res.webSocket?.close();
  });
});

describe('abuse limits', () => {
  it('drops a message over the payload size cap', async () => {
    const room = 'limits-test-1';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);

    const oversized = JSON.stringify({
      v: 1,
      room,
      device: 'device-a',
      to: 'device-b',
      kind: 'handoff',
      iv: 'x',
      ciphertext: 'y'.repeat(MAX_PAYLOAD_BYTES + 1),
      ts: 1,
    });
    a.send(oversized);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const drainRes = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    expect(
      ((await drainRes.json()) as { items: unknown[] }).items,
    ).toHaveLength(0);

    a.close();
  });

  it('caps queue depth per device', async () => {
    const room = 'limits-test-2';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);

    for (let i = 0; i < MAX_QUEUE_DEPTH_PER_DEVICE + 5; i++) {
      a.send(
        JSON.stringify({
          v: 1,
          room,
          device: 'device-a',
          to: 'device-b',
          kind: 'handoff',
          iv: 'x',
          ciphertext: `y${i}`,
          ts: i,
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const drainRes = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    const { items } = (await drainRes.json()) as { items: unknown[] };
    expect(items.length).toBeLessThanOrEqual(MAX_QUEUE_DEPTH_PER_DEVICE);

    a.close();
  });

  it('rate-limits messages per room', async () => {
    const room = 'limits-test-3';
    const tokenA = await registerDevice(room, 'device-a');
    const tokenB = await registerDevice(room, 'device-b', {
      asDevice: 'device-a',
      token: tokenA,
    });
    const a = await openAuthorizedSocket(room, 'device-a', tokenA);

    for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES + 10; i++) {
      a.send(
        JSON.stringify({
          v: 1,
          room,
          device: 'device-a',
          to: 'device-b',
          kind: 'handoff',
          iv: 'x',
          ciphertext: `y${i}`,
          ts: i,
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const drainRes = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ device: 'device-b' }),
      },
    );
    const { items } = (await drainRes.json()) as { items: unknown[] };
    expect(items.length).toBeLessThanOrEqual(RATE_LIMIT_MAX_MESSAGES);

    a.close();
  });
});

describe('CORS', () => {
  it('answers an OPTIONS preflight for an HTTP route', async () => {
    const room = 'cors-test-1';
    const res = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      { method: 'OPTIONS' },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain(
      'Authorization',
    );
  });

  it('sets Access-Control-Allow-Origin on a real pair/issue response', async () => {
    const room = 'cors-test-2';
    const res = await SELF.fetch(
      `https://example.com/room/${room}/pair/issue`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('sets Access-Control-Allow-Origin on an error response too', async () => {
    const room = 'cors-test-3';
    const res = await SELF.fetch(
      `https://example.com/room/${room}/inbox/drain`,
      {
        method: 'POST',
        body: JSON.stringify({ device: 'device-a' }),
      },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
