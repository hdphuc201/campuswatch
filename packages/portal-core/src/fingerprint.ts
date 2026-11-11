import type { CanonicalPayload, EntityType } from '@campuswatch/contracts';
import { canonicalEntries, canonicalizeValue } from './canonical.js';

export interface FingerprintInput {
  readonly entityType: EntityType;
  readonly externalKey: string;
  readonly payload: CanonicalPayload;
}

/**
 * SHA-256 over `entityType + externalKey + canonical payload` (plan section 7).
 * Uses Web Crypto so it runs unchanged in the extension and in Node.js.
 */
export async function fingerprintEntity(input: FingerprintInput): Promise<string> {
  const canonical = JSON.stringify([
    input.entityType,
    canonicalizeValue(input.externalKey),
    canonicalEntries(input.payload),
  ]);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
