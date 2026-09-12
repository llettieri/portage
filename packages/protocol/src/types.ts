export type EnvelopeKind = 'handoff' | 'presence' | 'stash';

export interface Envelope {
  v: number;
  room: string;
  device: string;
  to: string;
  kind: EnvelopeKind;
  iv: string;
  ciphertext: string;
  ts: number;
}

export interface EnvelopeHeader {
  v: number;
  room: string;
  device: string;
  to: string;
  kind: EnvelopeKind;
  ts: number;
}

export interface RelayFrame {
  id: string | null;
  envelope: Envelope;
}

export interface PairingPayload {
  v: number;
  room: string;
  salt: string;
  iterations: number;
  code: string;
  hubUrl: string;
}

export interface PairIssueRequest {
  device: string;
}

export interface PairIssueResponse {
  code: string;
  expiresAt: number;
  deviceToken?: string;
}

export interface PairConsumeRequest {
  code: string;
  device: string;
}

export interface PairConsumeResponse {
  deviceToken: string;
}

export interface PairRevokeRequest {
  device: string;
}

export interface InboxDrainRequest {
  device: string;
}

export interface InboxDrainResponse {
  items: RelayFrame[];
}

export interface InboxAckRequest {
  device: string;
  ids: string[];
}

export type StashItemOrigin = 'arc' | 'zen' | 'sidebar';

export interface StashItem {
  id: string;
  url: string;
  title: string;
  origin: StashItemOrigin;
  addedAt: number;
}

export interface HandoffPayload {
  url: string;
  title: string;
}

export interface PresencePayload {
  tabs: Array<{ url: string; title: string }>;
}
