import { Room, type Env } from './room.js';

export { Room };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/room\/([^/]+)(?:\/.*)?$/);
    const roomId = match?.[1];
    if (!roomId) {
      return new Response('expected /room/:roomId', { status: 404 });
    }

    const id = env.ROOM.idFromName(roomId);
    const stub = env.ROOM.get(id);
    return await stub.fetch(request);
  },
};
