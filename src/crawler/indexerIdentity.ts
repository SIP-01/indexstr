/**
 * Anonymous Indexing Identity (Search Index Protocol §10)
 *
 * Every browser/device automatically gets its own dedicated indexer keypair,
 * generated locally on first use. This key signs web-index observation events
 * (kind 39697) — it is NOT the user's personal Nostr identity, and the two
 * are never automatically linked.
 *
 * Same pattern as UNCAGED-ENGINE / 0xSearchstr.
 */
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** localStorage key for the device indexer secret (hex). */
const LS_INDEXER_SECRET = 'sip:indexer:secret';

export interface IndexerIdentity {
  secretHex: string;
  pubkeyHex: string;
  npub: string;
  fresh: boolean;
}

function isValidSecretHex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function readStored(): string | null {
  try {
    const raw = localStorage.getItem(LS_INDEXER_SECRET);
    return isValidSecretHex(raw) ? raw.toLowerCase() : null;
  } catch {
    return null;
  }
}

function writeStored(secretHex: string): void {
  try {
    localStorage.setItem(LS_INDEXER_SECRET, secretHex);
  } catch {
    // Storage unavailable (private mode etc.) — identity becomes session-only.
  }
}

function newSecretHex(): string {
  const sk = generateSecretKey();
  return bytesToHex(sk);
}

function toIdentity(secretHex: string, fresh: boolean): IndexerIdentity {
  const pubkeyHex = getPublicKey(hexToBytes(secretHex));
  return {
    secretHex,
    pubkeyHex,
    npub: nip19.npubEncode(pubkeyHex),
    fresh,
  };
}

/**
 * Get this device's indexing identity, generating and persisting a fresh
 * keypair on first use. Deterministic across reloads in the same browser
 * profile; different profiles get different keys.
 */
export function getIndexerIdentity(): IndexerIdentity {
  const existing = readStored();
  if (existing) {
    try {
      return toIdentity(existing, false);
    } catch {
      // Corrupted — fall through to fresh generation
    }
  }

  const secretHex = newSecretHex();
  writeStored(secretHex);
  return toIdentity(secretHex, true);
}

/** Regenerate the indexing identity. Creates a NEW indexer. */
export function regenerateIndexerIdentity(): IndexerIdentity {
  const secretHex = newSecretHex();
  writeStored(secretHex);
  return toIdentity(secretHex, true);
}

/** Export the indexing secret as an nsec (bech32). */
export function exportIndexerNsec(): string {
  const identity = getIndexerIdentity();
  return nip19.nsecEncode(hexToBytes(identity.secretHex));
}

/** The device's indexer pubkey (hex), generating the identity if needed. */
export function getIndexerPubkey(): string {
  return getIndexerIdentity().pubkeyHex;
}

/** The raw secret key bytes for signing. Never expose beyond signing. */
export function getIndexerSecretKey(): Uint8Array {
  return hexToBytes(getIndexerIdentity().secretHex);
}
