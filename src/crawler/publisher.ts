/**
 * Index publisher — signs and publishes SIP-01 web index observations
 * (kind 39697). Canonical spec: https://github.com/SIP-01/SIP-01
 * (public/spec/SIP-01.md, v1.2).
 *
 * Every observation is signed by THIS DEVICE's dedicated indexer identity
 * (indexerIdentity.ts) — never the user's personal Nostr key, and
 * the event never contains a search query. The user's identity and the
 * indexer identity are never linked on purpose.
 *
 * Relay resilience:
 *   - each event is pushed to every relay in the publish set, best-effort
 *   - per-relay health is tracked (see getRelayHealth) for the settings UI
 *   - when ZERO relays accept an event, it is held in the IndexedDB outbox
 *     and flushed when connectivity returns — local-first, nothing lost
 */

import { finalizeEvent } from 'nostr-tools/pure';
import type { NostrEvent } from '@nostrify/nostrify';

import { getIndexerIdentity, getIndexerSecretKey } from './indexerIdentity';
import { buildIndexEvent, normalizeIndexUrl, type IndexObservationInput } from './webIndex';
import { getIndexPublishRelays } from './relays';
import { enqueueOutbox, flushOutbox } from './queue';

/** Callback type for publishing a signed event to a relay. */
export type RelayPublishFn = (relayUrl: string, event: NostrEvent) => Promise<void>;

/** Injected relay publisher — wired up by the React hook. */
let relayPublishFn: RelayPublishFn | null = null;

export function setRelayPublisher(fn: RelayPublishFn) {
  relayPublishFn = fn;
}

/* --------------------------------------------------------------