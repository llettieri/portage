# Portage

Cross-browser tab handoff between **Arc on macOS** and **Zen on Windows** (a Firefox fork).
One browser extension, cross-built for both browsers, plus an encrypted Cloudflare hub.
No native code, no daemons.

Full design rationale: https://claude.ai/code/artifact/6666558e-cab5-4936-a1ef-4ed807bdd7b2

## Architecture

```
packages/
  protocol/       # shared TS types + WebCrypto helpers. No runtime deps.
  hub/            # Cloudflare Worker -> one Durable Object per room
  ext/            # single WXT extension, built for both Chrome (MV3) and Firefox (MV2)
```

pnpm workspaces. `protocol` is a `workspace:*` dependency of the other two.

Three message kinds, all through the same encrypted envelope:

- **handoff** — "send this tab to device X". Queued per recipient device, deleted on ack.
- **presence** — periodic snapshot of open tabs. Replaces, never merges.
- **stash** — shared list of saved links. Serialised by the DO.

## Hard constraints

These are deliberate decisions, not oversights. Do not "modernise" them without asking.

1. **`ext`'s background script must stay `defineBackground({ persistent: true })`, and its
   Firefox build target must not be migrated to Firefox's MV3 event-page model.** Firefox
   MV3 offers only non-persistent event pages that unload after seconds, and MDN is
   explicit that ports cannot prevent shutdown — a WebSocket there is unreliable. Firefox
   still supports MV2 with a persistent background page, and AMO still signs it. Do not
   migrate the Firefox build target to MV3.

2. **`ext`'s Chrome build target must survive service-worker termination at any moment.**
   Chromium resets the 30s idle timer on WebSocket traffic (Chrome 116+), but the worker
   can still be killed. Keep zero state in module globals — the one documented exception
   is the `cachedCryptoKey` fast-path cache, which must always fall back to re-deriving
   the key from `browser.storage.session` plus the room's stored salt/iterations if the
   worker was killed and restarted. Reconnect must be idempotent.

3. **The Durable Object holds a per-device inbox queue. The WebSocket is an optimisation,
   not the delivery mechanism.** Either client can be asleep when something is sent.
   Clients drain their queue on connect, on popup open, at browser startup, and on a
   `chrome.alarms` tick. Never implement live broadcast without the queue behind it.

4. **N devices, not 2.** Arc-Mac, Zen-Mac (for testing), Zen-Windows — at least three.
   Never assume "the other device" anywhere. Address by `deviceId`; "send to" is a picker.
   Device IDs are random per install, stored in extension storage, derived from nothing.

5. **All crypto lives in `protocol/` and is used identically across `ext`'s Chrome and
   Firefox build targets.** WebCrypto only — PBKDF2 to derive an AES-GCM key from a
   passphrase, fresh 96-bit IV per message. Duplicating this logic across build targets
   will cause silent drift and undebuggable "decryption failed" errors. The hub stores
   ciphertext and never sees a URL.

6. **Durable Objects only — never Workers KV for sync state.** KV is eventually consistent
   (up to 60s+, and negative lookups cache too), which would break handoff. The DO is
   single-threaded per room, which is also why there is no CRDT anywhere in this project:
   it provides a total order for free.

7. **The Zen bookmark mirror writes into one dedicated folder and reads nothing back.**
   Anything outside that folder is the user's own and must never be touched.

8. **Arc's pinned tabs and Spaces are out of scope.** They live in a private
   `StorableSidebar.json` that extensions cannot read, and reaching them would require
   native code that was explicitly rejected. Do not add native messaging. `StashItem.origin`
   reserves a `'sidebar'` value if that decision is ever revisited.

9. **`browser_specific_settings.gecko.id` is permanent** once the add-on is first submitted
   to AMO. Never change it.

## Conventions

- TypeScript strict everywhere. `protocol` is the only shared code; there is a single
  extension package (`ext`), so no cross-import concern between separate extension
  packages applies.
- Each package owns its build: `wrangler` for hub, WXT for `ext` (compiles the one source
  tree to both a Chrome MV3 build and a Firefox MV2 build).
- Pin dependency versions at install time. Do not guess version numbers.
- Set `compatibility_date` in `wrangler.toml` to the date the file is created.
- The DO must use the SQLite storage backend — it is the only backend on the Workers free
  plan. Verify the current migration syntax against Cloudflare's docs rather than assuming.

## Out of scope, permanently

Arc pinned tabs, Arc Spaces, Zen Workspaces, Arc-on-Windows as a sync sink, any macOS
background agent, any native messaging host, any CRDT.
