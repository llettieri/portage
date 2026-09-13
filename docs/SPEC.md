# Portage — specification

Portage moves browser tabs between a person's own browsers. It is a personal tool: one person,
a handful of their own devices, no accounts, no third-party service.

This document specifies the finished system — what it does and how it behaves. It carries no
implementation status. `CLAUDE.md` holds the non-negotiable constraints and the reasoning
behind them, including what was rejected along the road.

MUST / MUST NOT / SHOULD carry their usual force.

---

## 1. Scope

**In scope.** Sending the active tab from one browser to every other browser the person has
paired, including browsers that are closed at the time. Seeing what is open elsewhere.

**Out of scope, permanently.** Arc's pinned tabs and Spaces, Zen's Workspaces, any native
binary, any background daemon, any browser-agnostic bookmark sync, multi-user rooms. These are
settled decisions, not gaps — see `CLAUDE.md`.

**Portability.** Nothing depends on Arc or Zen specifically. The Chromium build MUST run in any
Chromium; the Gecko build MUST run in any Firefox. Arc in particular is a frozen browser and the
system is expected to outlive it.

---

## 2. Concepts

**Room** — the unit of grouping. One person's set of browsers. Identified by a 128-bit random
room ID, which is a capability, not a name: whoever knows it can reach the hub for that room.
Room IDs MUST be randomly generated; never `test`, `default`, or anything guessable.

**Device** — one extension installation. Identified by a random UUID minted at install,
persisted in extension storage, derived from nothing about the machine. A device holds a bearer
token that authenticates it to the hub.

**Passphrase** — chosen by the person, shared between their own browsers during pairing, and
never sent to the hub. Everything the hub stores is encrypted under a key derived from it.

**Envelope** — the unit on the wire. A cleartext routing header plus an encrypted payload.

---

## 3. Components

| Component | Responsibility |
|---|---|
| `protocol` | Wire types, crypto, header canonicalisation, pairing codec, hub URL handling, reconnect policy. Zero runtime dependencies. The single source of truth for anything that crosses a boundary. |
| `hub` | Cloudflare Worker routing `/room/:roomId` to one Durable Object per room. Authenticates devices, relays and queues envelopes, issues and revokes device tokens. Stores ciphertext only. |
| `ext` | WXT extension, one project built for two targets: MV3 for Chromium (Arc), MV2 with a persistent background page for Gecko (Zen). |

Both build targets MUST present the same behaviour and the same UI affordances. Divergence is
permitted only where the browser platforms genuinely differ (background page lifetime).

Any type that crosses a boundary MUST be defined in `protocol` and imported by every package
that speaks it. A wire-format change is not complete until every such package is updated and
type-checked against it.

---

## 4. Wire format

### 4.1 Envelope

```ts
interface Envelope {
  v: number            // format version
  room: string         // room id
  device: string       // sending device id
  to: string           // recipient device id, or 'all'
  kind: 'handoff' | 'presence' | 'stash'
  iv: string           // base64, 96-bit, fresh per message
  ciphertext: string   // base64 AES-GCM
  ts: number           // sender clock, milliseconds
}
```

The header fields (`v`, `room`, `device`, `to`, `kind`, `ts`) are cleartext because the hub
routes on them. They are **not** unauthenticated: they are bound into the ciphertext as
additional authenticated data (§5.3).

`to` MUST be present. An envelope without it MUST be dropped and logged by the hub, never
relayed — a missing recipient must fail closed rather than fan out.

### 4.2 Relay frame

The hub never relays a bare envelope. It wraps each one:

```ts
interface RelayFrame {
  id: string | null    // inbox row id, for acknowledgement
  envelope: Envelope
}
```

### 4.3 Payloads

Payloads are JSON, encrypted. Each `kind` has a fixed payload shape, validated after decryption
rather than cast blindly:

- `handoff` — `{ url: string, title: string }`. One tab.
- `presence` — `{ tabs: Array<{ url: string, title: string }> }`. A snapshot of what is open on
  the sending device.
- `stash` — `StashItem[]`. Reserved. Its semantics are deliberately unspecified; the system
  holds no shared mutable state today (§7.4).

`StashItem.origin` includes a `'sidebar'` value, reserved for a future producer reading Arc's
sidebar. Nothing emits it.

---

## 5. Cryptography

### 5.1 Key derivation

PBKDF2-HMAC-SHA256 over the passphrase, producing a 256-bit AES-GCM key.

- Salt: 128 bits, random, generated once when the room is created.
- Iterations: 600,000 for new rooms.

The salt and the iteration count travel in the pairing payload and are stored alongside the room
config. The iteration count MUST be stored rather than assumed, so it can be raised later
without breaking existing rooms. The derived key MUST be non-extractable.

### 5.2 Encryption

AES-GCM, with a fresh 96-bit IV per message. An IV MUST NOT be reused under the same key.

### 5.3 Header binding

The canonical serialisation of the header is passed as AES-GCM additional authenticated data.
Canonical form is the fields in fixed order — `v`, `room`, `device`, `to`, `kind`, `ts` — joined
by NUL. A field containing NUL MUST be rejected at serialisation, since it would make the
encoding ambiguous.

The effect: a header field cannot be altered in transit. Relabelling a `stash` envelope as a
`handoff`, or rewriting `device` to reattribute a message, makes decryption fail. Both ends MUST
derive the AAD from the header they actually have, never from a cached copy.

### 5.4 Passphrase verification

On unlock, the extension encrypts and decrypts a fixed key-check value with the derived key. A
wrong passphrase MUST be reported plainly in the UI. It MUST NOT present as an empty inbox or as
silence — an indistinguishable failure mode is the worst outcome here.

### 5.5 Where key material lives

The passphrase is held in **session** storage, not local storage: it survives service-worker
termination but not a browser restart. The derived `CryptoKey` is re-derived from it on demand
and MUST NOT be persisted — a `CryptoKey` cannot round-trip through extension storage and is
silently dropped if attempted.

Consequence: after a browser restart the person re-enters the passphrase (§8.2). This is a
deliberate trade, not an oversight.

A lost passphrase means an unrecoverable room. The hub cannot help; that is the point.

---

## 6. Hub

### 6.1 Addressing

`/room/:roomId` routes to one Durable Object instance per room. The Durable Object is
single-threaded, which serialises every write for a room and is why the system needs no CRDT and
no conflict resolution anywhere.

### 6.2 Authentication

Every device holds a bearer token, issued at pairing and stored hashed by the hub. The hub MUST
NOT store tokens in plaintext.

- **WebSocket upgrade** — `device` and `token` as query parameters. Unauthorised requests MUST be
  rejected at the upgrade with 401, never accepted and then ignored.
- **HTTP routes** — `Authorization: Bearer <token>`.

Bootstrap exception: `pair/issue` on a room with zero registered devices requires no auth and
registers the caller. This is what lets the first device claim an empty room. Every subsequent
call requires a valid token.

### 6.3 HTTP routes

All are POST under `/room/:roomId/`.

| Route | Auth | Behaviour |
|---|---|---|
| `pair/issue` | bearer, or none when the room is empty | Mints a single-use pairing code with a 5-minute TTL. Returns a device token too when bootstrapping. |
| `pair/consume` | pairing code | Registers a new device and returns its token. Rejects an already-registered device id (409) and an invalid, used, or expired code (403). |
| `pair/revoke` | bearer, any registered device | Marks a device revoked. Its token stops working immediately, at the upgrade and on HTTP. |
| `inbox/drain` | bearer, must match `device` | Returns queued frames for that device, oldest first. Does not delete. |
| `inbox/ack` | bearer, must match `device` | Deletes the named rows for that device. |

Drain and ack are separate so a crash between receiving and storing cannot lose an item: the
item stays queued until the recipient says it has it.

CORS is permissive. The routes are called cross-origin from `chrome-extension://` and
`moz-extension://` origins, and they carry their own auth — a non-browser client could reach them
identically. Permissive CORS therefore lets the browser do what `curl` already could; it is not
part of the security boundary.

### 6.4 Storage

Three tables in the Durable Object's SQLite:

- `devices` — device id, hashed token, revoked flag, creation time.
- `pairing_codes` — code, expiry, used flag.
- `inbox` — row id, recipient device, the envelope as stored, creation time. Indexed by
  recipient.

Envelopes are stored exactly as received. The hub MUST NOT attempt to read a payload, and MUST
NOT log one. Logging a `kind` is acceptable; logging an envelope body is not.

### 6.5 Limits

| Limit | Value |
|---|---|
| Max payload | 64 KiB (WebSocket message and HTTP body) |
| Max queue depth per device | 500 |
| Rate limit | 60 messages per 10-second window, per room |
| Pairing code TTL | 5 minutes, single use |
| Queue item expiry | 30 days |

An over-cap queue drops the new item for that device rather than evicting an old one or
partially delivering to some devices and not others. Expiry is swept opportunistically on
enqueue and drain.

---

## 7. Delivery semantics

### 7.1 Broadcast

A sent tab reaches **every** other device in the room. `to` is `'all'`; there is no recipient
picker, and adding one is out of scope.

`to` nonetheless stays on the envelope and stays AAD-bound, for two reasons: the hub routes
per-device queues on it, and a targeted mode later must not require a wire-format change.

The sender never receives its own message back.

### 7.2 Queue-first, socket as optimisation

Every message is enqueued per recipient device *before* any live delivery is attempted. A
connected device also gets it pushed down its socket immediately; a disconnected one gets it on
next drain. Delivery MUST NOT depend on both devices being awake at the same time.

A device drains its inbox:

- on connect,
- on unlock,
- when the popup opens,
- on browser startup,
- on a periodic timer.

An item is deleted only when acknowledged.

### 7.3 Independent copies

Each device holds its **own** copy of a received item. Opening or dismissing it on one device
does not affect any other. There are deliberately no cross-device acknowledgements, no shared
inbox state, and no "seen" propagation.

### 7.4 No shared mutable state

Nothing in the system is jointly owned and mutated. This is why there is no CRDT, no vector
clock, no tombstone, and no merge logic anywhere — and any proposal that reintroduces one should
be treated as a change of direction rather than an implementation detail.

### 7.5 Ordering and duplicates

The Durable Object serialises writes, so per-room ordering is well defined. Recipients MUST
tolerate a redelivered frame — a crash between drain and ack legitimately produces one — and MUST
deduplicate on frame id rather than storing it twice.

---

## 8. Extension behaviour

### 8.1 Pairing

The first device creates the room: it generates a room ID and salt, takes a passphrase from the
person, and claims the empty room via `pair/issue`.

Adding a device: an existing device issues a pairing code and displays a pairing payload —
base64 of `{ v, room, salt, iterations, code, hubUrl }`. The new device consumes it, is issued a
token, and asks for the passphrase separately.

The passphrase MUST NOT appear in the pairing payload and MUST NOT reach the hub. The payload
MUST remain visible until dismissed; it must not vanish the instant it is shown.

### 8.2 Unlock and reset

**Unlock** re-derives the key from a re-entered passphrase. Needed after a browser restart,
since the passphrase lives in session storage. A wrong passphrase is reported plainly.

**Forget this room** clears local room config, device identity, and queued items. It is a local
reset. Removing a device's access for everyone is `pair/revoke`.

### 8.3 Sending

One action: send the active tab. The extension builds a `handoff` envelope addressed to `'all'`
and transmits it.

The result MUST be reported to the person. A failure — no room configured, locked, not
connected, no active tab — MUST name which. Silent success reporting is forbidden: the UI must
never say a tab was sent when it was not.

Note for implementers: an extension background context has no "current window", so the active
tab MUST be resolved by last-focused window, not current window.

### 8.4 Receiving

Received items are stored as a **list**, keyed by frame id, and rendered in the popup. Multiple
arrivals are the normal case under broadcast. A duplicate id MUST NOT create a second entry. The
list is capped, dropping oldest first.

**A received URL MUST NOT be opened automatically, ever.** The person clicks to open. Only
`http:` and `https:` schemes are accepted; anything else is discarded on arrival. This holds
permanently and regardless of how trusted the room is — automatic navigation would turn any
compromise of the room into remote page-opening in the person's browser.

Opening or dismissing an item removes it from that device only.

### 8.5 Connection lifecycle

The extension keeps a WebSocket to its room when it can. On close it reconnects with exponential
backoff and jitter — base 1s, factor 2, ceiling 60s, ±20% — shared from `protocol` so both
extensions behave identically. A periodic alarm acts as a fallback heartbeat, so a missed
reconnect cannot strand a device indefinitely.

Connection state MUST be visible in the popup and reflect reality, not the last thing that was
attempted.

Platform notes. The Chromium service worker can be terminated at any moment: no state may live
in module globals, all of it goes through extension storage, and reconnect must be idempotent. A
live socket does keep the worker alive on current Chromium, but the design must not depend on
it. The Gecko build uses MV2 with a persistent background page, because Firefox MV3 event pages
unload within seconds and ports cannot prevent it.

### 8.6 Hub URL

Configured by the person, stored locally. It MUST be `ws://` or `wss://`. An `https://` URL MUST
be rejected loudly rather than coerced — silently downgrading would put a bearer token on the
wire in cleartext.

---

## 9. Security model

**What the hub can see.** Room ID, device IDs, message sizes, timing, message kinds, and which
device sent to which. It cannot read a URL, a page title, or any payload.

**What the hub cannot do.** Forge a message — the AAD binding makes header tampering fail
decryption. Recover a passphrase. Serve payloads to anyone lacking a valid device token.

**What an attacker who learns a room ID gets.** Nothing, without a device token: the upgrade is
rejected and every HTTP route is authenticated. The exception is an *empty* room, where
`pair/issue` bootstraps without auth — so a room ID MUST be treated as secret from creation, not
from first pairing.

**What an attacker who steals a device token gets.** The ability to enqueue and drain envelopes
for that room. They still cannot read anything without the passphrase. Revoke the device.

**What the person is trusted with.** The passphrase, the room ID, and the pairing payload.
Pairing happens between their own browsers; no out-of-band channel is verified.

**Deliberate non-defences.** Traffic analysis, a compromised browser profile, a malicious
extension in the same browser, and the hub operator correlating metadata. All out of scope for a
personal tool.

---

## 10. Distribution

The Gecko build is signed through AMO on the **unlisted** channel and self-installed; it is never
publicly listed. Each submission needs a unique version, so the release process bumps it
automatically. The add-on id is permanent.

Because the shipped JavaScript is generated by a bundler, a reproducible source archive
accompanies each submission — the extension package plus `protocol`, with exact toolchain
versions and build instructions, such that a reviewer can rebuild byte-identical output.

The add-on declares its data collection honestly. It transmits browsing activity — tab URLs and
titles — to a destination the person configures. End-to-end encryption does not change what is
declared.

The Chromium build is loaded unpacked. It is not submitted to any store.

---

## 11. Invariants

The short list. A change that violates one of these is a change of direction.

1. The hub never sees plaintext.
2. A received URL is never opened without a human click.
3. A wire-format change lands in every package that speaks it, simultaneously.
4. No code path assumes exactly two devices.
5. Delivery never requires two devices to be awake at once.
6. Nothing is jointly mutated; therefore nothing needs merging.
7. Failures are reported, never swallowed. Silence is a bug.
