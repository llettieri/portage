import type {
  Envelope,
  InboxAckRequest,
  InboxDrainRequest,
  InboxDrainResponse,
  PairConsumeRequest,
  PairConsumeResponse,
  PairIssueRequest,
  PairIssueResponse,
  PairRevokeRequest,
  RelayFrame,
} from 'protocol';
import { isEchoableCloseCode } from './closeCodes.js';
import { MAX_PAYLOAD_BYTES, MAX_QUEUE_DEPTH_PER_DEVICE, RATE_LIMIT_MAX_MESSAGES, RATE_LIMIT_WINDOW_MS } from './limits.js';
import { hashToken, randomPairingCode, randomToken } from './tokens.js';

const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const QUEUE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export interface Env {
  ROOM: DurableObjectNamespace;
}

// `cloudflare:test`'s `env` export is typed as `Cloudflare.Env`, which is normally
// populated by running `wrangler types` to generate a `worker-configuration.d.ts`.
// This project doesn't run that codegen step, so declare the binding here instead —
// this is the same shape as `Env` above, just merged into the ambient namespace so
// `room.test.ts` can do `env.ROOM.idFromName(...)`.
declare global {
  namespace Cloudflare {
    interface Env {
      ROOM: DurableObjectNamespace;
    }
  }
}

interface SocketAttachment {
  deviceId: string;
}

// Type aliases (not interfaces) so TypeScript synthesizes the implicit index
// signature needed to satisfy `sql.exec<T>()`'s `T extends Record<string, SqlStorageValue>`
// constraint — interfaces don't get this treatment.
type DeviceRow = {
  tokenHash: string;
  revoked: number;
};

type PairingCodeRow = {
  expiresAt: number;
  used: number;
};

export class Room implements DurableObject {
  private messageTimestamps: number[] = [];

  constructor(private readonly state: DurableObjectState) {
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS pairing_codes (
        code TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        used INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY,
        to_device TEXT NOT NULL,
        envelope TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    this.state.storage.sql.exec('CREATE INDEX IF NOT EXISTS inbox_to_device_idx ON inbox (to_device)');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sub = url.pathname.split('/').filter(Boolean).slice(2).join('/');

    if (request.headers.get('Upgrade') === 'websocket') return this.handleUpgrade(request, url);

    // The HTTP routes below are called cross-origin from a browser extension
    // (chrome-extension://…, moz-extension://…), which browsers subject to CORS.
    // These routes carry their own auth (bearer token or single-use pairing code) with
    // no origin check — a non-browser client could reach them identically via a plain
    // HTTP request regardless of CORS — so a permissive policy here doesn't weaken the
    // actual security boundary, it only lets the browser allow what curl already could.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    let response: Response;
    try {
      response = await this.dispatchHttp(request, sub);
    } catch (error) {
      response = new Response(`internal error: ${String(error)}`, { status: 500 });
    }
    response.headers.set('Access-Control-Allow-Origin', '*');
    return response;
  }

  private async dispatchHttp(request: Request, sub: string): Promise<Response> {
    if (request.method === 'POST' && (sub === 'pair/issue' || sub === 'pair/consume' || sub === 'pair/revoke')) {
      if (!this.checkRateLimit()) return new Response('rate limited', { status: 429 });
    }
    if (request.method === 'POST') {
      const contentLength = Number(request.headers.get('Content-Length') ?? '0');
      if (contentLength > MAX_PAYLOAD_BYTES) return new Response('payload too large', { status: 413 });
    }
    if (request.method === 'POST' && sub === 'pair/issue') return this.handlePairIssue(request);
    if (request.method === 'POST' && sub === 'pair/consume') return this.handlePairConsume(request);
    if (request.method === 'POST' && sub === 'pair/revoke') return this.handlePairRevoke(request);
    if (request.method === 'POST' && sub === 'inbox/drain') return this.handleInboxDrain(request);
    if (request.method === 'POST' && sub === 'inbox/ack') return this.handleInboxAck(request);
    if (sub === '') return new Response('expected websocket upgrade', { status: 426 });
    return new Response('not found', { status: 404 });
  }

  private async handleUpgrade(request: Request, url: URL): Promise<Response> {
    const deviceId = url.searchParams.get('device') ?? '';
    const token = url.searchParams.get('token') ?? '';
    if (!deviceId || !token || !(await this.isAuthorized(deviceId, token))) {
      return new Response('unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ deviceId } satisfies SocketAttachment);
    this.state.acceptWebSocket(server, [deviceId]);
    return new Response(null, { status: 101, webSocket: client });
  }

  private deviceCount(): number {
    const rows = this.state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM devices').toArray();
    return Number(rows[0]?.n ?? 0);
  }

  private async registerDevice(deviceId: string): Promise<string> {
    const token = randomToken();
    const tokenHash = await hashToken(token);
    this.state.storage.sql.exec(
      'INSERT OR REPLACE INTO devices (device_id, token_hash, revoked, created_at) VALUES (?, ?, 0, ?)',
      deviceId,
      tokenHash,
      Date.now(),
    );
    return token;
  }

  private async checkBearerAuth(request: Request, deviceId: string): Promise<boolean> {
    const header = request.headers.get('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    return this.isAuthorized(deviceId, token);
  }

  private async isAuthorized(deviceId: string, token: string): Promise<boolean> {
    if (!token) return false;
    const rows = this.state.storage.sql
      .exec<DeviceRow>('SELECT token_hash AS tokenHash, revoked FROM devices WHERE device_id = ?', deviceId)
      .toArray();
    const row = rows[0];
    if (!row || row.revoked) return false;
    return (await hashToken(token)) === row.tokenHash;
  }

  private async handlePairIssue(request: Request): Promise<Response> {
    const body = (await request.json()) as PairIssueRequest;
    if (!body.device) return new Response('missing device', { status: 400 });

    const isBootstrap = this.deviceCount() === 0;
    if (!isBootstrap && !(await this.checkBearerAuth(request, body.device))) {
      return new Response('unauthorized', { status: 401 });
    }

    const code = randomPairingCode();
    const expiresAt = Date.now() + PAIRING_CODE_TTL_MS;
    this.state.storage.sql.exec(
      'INSERT INTO pairing_codes (code, expires_at, used) VALUES (?, ?, 0)',
      code,
      expiresAt,
    );

    const response: PairIssueResponse = { code, expiresAt };
    if (isBootstrap) response.deviceToken = await this.registerDevice(body.device);
    return Response.json(response);
  }

  private async handlePairConsume(request: Request): Promise<Response> {
    const body = (await request.json()) as PairConsumeRequest;
    if (!body.code || !body.device) return new Response('missing code or device', { status: 400 });

    const existing = this.state.storage.sql
      .exec('SELECT 1 FROM devices WHERE device_id = ?', body.device)
      .toArray();
    if (existing.length > 0) {
      return new Response('device id already registered', { status: 409 });
    }

    const rows = this.state.storage.sql
      .exec<PairingCodeRow>('SELECT expires_at AS expiresAt, used FROM pairing_codes WHERE code = ?', body.code)
      .toArray();
    const row = rows[0];
    if (!row || row.used || row.expiresAt < Date.now()) {
      return new Response('pairing code invalid or expired', { status: 403 });
    }

    this.state.storage.sql.exec('UPDATE pairing_codes SET used = 1 WHERE code = ?', body.code);
    const deviceToken = await this.registerDevice(body.device);
    const response: PairConsumeResponse = { deviceToken };
    return Response.json(response);
  }

  private async handlePairRevoke(request: Request): Promise<Response> {
    const body = (await request.json()) as PairRevokeRequest;
    if (!body.device) return new Response('missing device', { status: 400 });

    const authHeader = request.headers.get('Authorization') ?? '';
    const callerToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
    const rows = this.state.storage.sql
      .exec('SELECT device_id AS deviceId, token_hash AS tokenHash, revoked FROM devices WHERE revoked = 0')
      .toArray() as Array<{ deviceId: string; tokenHash: string; revoked: number }>;

    let callerAuthorized = false;
    for (const row of rows) {
      if ((await hashToken(callerToken)) === row.tokenHash) {
        callerAuthorized = true;
        break;
      }
    }
    if (!callerToken || !callerAuthorized) return new Response('unauthorized', { status: 401 });

    this.state.storage.sql.exec('UPDATE devices SET revoked = 1 WHERE device_id = ?', body.device);
    return new Response(null, { status: 200 });
  }

  webSocketMessage(sender: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return;
    if (message.length > MAX_PAYLOAD_BYTES) return;
    if (!this.checkRateLimit()) return;

    let envelope: Envelope;
    try {
      envelope = JSON.parse(message) as Envelope;
    } catch {
      return;
    }

    if (!envelope.to) {
      // getWebSockets(undefined) returns every socket in the room, not zero — an
      // envelope missing `to` must be dropped explicitly, never fanned out.
      console.log('dropping envelope with no `to`', envelope);
      return;
    }

    if (envelope.to === 'all') {
      const senderAttachment = sender.deserializeAttachment() as SocketAttachment | null;
      const deviceRows = this.state.storage.sql
        .exec<{ deviceId: string }>('SELECT device_id AS deviceId FROM devices WHERE revoked = 0')
        .toArray();
      for (const row of deviceRows) {
        if (row.deviceId === senderAttachment?.deviceId) continue;
        const id = this.enqueue(row.deviceId, envelope);
        if (id === null) continue; // queue full for this device — drop rather than partially deliver
        const frame: RelayFrame = { id, envelope };
        const payload = JSON.stringify(frame);
        for (const socket of this.state.getWebSockets(row.deviceId)) {
          if (socket !== sender) socket.send(payload);
        }
      }
      return;
    }

    const id = this.enqueue(envelope.to, envelope);
    if (id === null) return; // queue full for this device — drop rather than partially deliver
    const frame: RelayFrame = { id, envelope };
    const payload = JSON.stringify(frame);
    for (const socket of this.state.getWebSockets(envelope.to)) {
      if (socket !== sender) socket.send(payload);
    }
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    this.messageTimestamps = this.messageTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (this.messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) return false;
    this.messageTimestamps.push(now);
    return true;
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    if (isEchoableCloseCode(code)) {
      ws.close(code, reason);
    } else {
      ws.close();
    }
  }

  private expireOldInboxRows(): void {
    this.state.storage.sql.exec('DELETE FROM inbox WHERE created_at < ?', Date.now() - QUEUE_EXPIRY_MS);
  }

  private enqueue(toDeviceId: string, envelope: Envelope): string | null {
    this.expireOldInboxRows();
    const countRows = this.state.storage.sql
      .exec('SELECT COUNT(*) AS n FROM inbox WHERE to_device = ?', toDeviceId)
      .toArray() as Array<{ n: number }>;
    if (Number(countRows[0]?.n ?? 0) >= MAX_QUEUE_DEPTH_PER_DEVICE) return null;

    const id = crypto.randomUUID();
    this.state.storage.sql.exec(
      'INSERT INTO inbox (id, to_device, envelope, created_at) VALUES (?, ?, ?, ?)',
      id,
      toDeviceId,
      JSON.stringify(envelope),
      Date.now(),
    );
    return id;
  }

  private async handleInboxDrain(request: Request): Promise<Response> {
    const body = (await request.json()) as InboxDrainRequest;
    if (!body.device) return new Response('missing device', { status: 400 });
    if (!(await this.checkBearerAuth(request, body.device))) return new Response('unauthorized', { status: 401 });

    this.expireOldInboxRows();
    const rows = this.state.storage.sql
      .exec('SELECT id, envelope FROM inbox WHERE to_device = ? ORDER BY created_at ASC', body.device)
      .toArray() as Array<{ id: string; envelope: string }>;
    const items: RelayFrame[] = rows.map((row) => ({ id: row.id, envelope: JSON.parse(row.envelope) as Envelope }));
    return Response.json({ items } satisfies InboxDrainResponse);
  }

  private async handleInboxAck(request: Request): Promise<Response> {
    const body = (await request.json()) as InboxAckRequest;
    if (!body.device) return new Response('missing device', { status: 400 });
    if (!Array.isArray(body.ids)) return new Response('missing or invalid ids', { status: 400 });
    if (!(await this.checkBearerAuth(request, body.device))) return new Response('unauthorized', { status: 401 });

    for (const id of body.ids) {
      this.state.storage.sql.exec('DELETE FROM inbox WHERE id = ? AND to_device = ?', id, body.device);
    }
    return new Response(null, { status: 200 });
  }
}
