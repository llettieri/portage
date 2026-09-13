// `cloudflare:test`'s `env` export is typed as `Cloudflare.Env`, which is normally
// populated by running `wrangler types` to generate a `worker-configuration.d.ts`.
// This project doesn't run that codegen step, so declare the binding here instead —
// this is the same shape as `Env` in room.ts, just merged into the ambient namespace so
// `room.test.ts` can do `env.ROOM.idFromName(...)`.
declare global {
  namespace Cloudflare {
    interface Env {
      ROOM: DurableObjectNamespace;
    }
  }
}

export {};
