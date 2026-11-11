import type { CanonicalPayload, EntityType, NormalizedEntity } from '@campuswatch/contracts';
import { normalizedEntitySchema } from '@campuswatch/contracts';
import { canonicalEntries, fingerprintEntity } from '@campuswatch/portal-core';
import { drift } from './errors.js';

/** A parsed entity before fingerprinting. */
export interface DraftEntity {
  readonly entityType: EntityType;
  readonly externalKey: string;
  readonly payload: CanonicalPayload;
}

/** Same key twice in one page (e.g. a retaken course): suffix later ones "#2", "#3"… */
export function uniqueKeys(drafts: DraftEntity[]): DraftEntity[] {
  const seen = new Map<string, number>();
  return drafts.map((draft) => {
    const id = `${draft.entityType}\u0000${draft.externalKey}`;
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    return count === 1 ? draft : { ...draft, externalKey: `${draft.externalKey}#${count}` };
  });
}

/** Canonicalizes payloads, adds SHA-256 fingerprints, and validates the shared contract. */
export async function finalizeDrafts(drafts: DraftEntity[]): Promise<NormalizedEntity[]> {
  return Promise.all(
    uniqueKeys(drafts).map(async (draft) => {
      const payload = Object.fromEntries(canonicalEntries(draft.payload));
      const entity = {
        entityType: draft.entityType,
        externalKey: draft.externalKey,
        payload,
        fingerprint: await fingerprintEntity({ ...draft, payload }),
      };
      const parsed = normalizedEntitySchema.safeParse(entity);
      if (!parsed.success) {
        throw drift(`${draft.entityType}: entity failed validation`);
      }
      return parsed.data;
    }),
  );
}

/** SHA-256 hex of a string (Web Crypto: works in the page, the extension, and Node). */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
