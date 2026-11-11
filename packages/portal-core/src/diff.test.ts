import type { CanonicalPayload, NormalizedEntity } from '@campuswatch/contracts';
import { describe, expect, it } from 'vitest';
import { diffEntities } from './diff.js';
import { fingerprintEntity } from './fingerprint.js';

async function grade(externalKey: string, payload: CanonicalPayload): Promise<NormalizedEntity> {
  const entityType = 'grade_course';
  return {
    entityType,
    externalKey,
    payload,
    fingerprint: await fingerprintEntity({ entityType, externalKey, payload }),
  };
}

describe('diffEntities', () => {
  it('reports no changes for the same snapshot in a different row order', async () => {
    const a = await grade('CS101', { final: 8.5 });
    const b = await grade('CS102', { final: null });

    expect(diffEntities([a, b], [b, a])).toEqual([]);
  });

  it('detects added, updated, and removed entities with field-level changes', async () => {
    const kept = await grade('CS101', { final: null, midterm: 7 });
    const removed = await grade('CS102', { final: 6 });
    const updated = await grade('CS101', { final: 9, midterm: 7 });
    const added = await grade('CS103', { final: null });

    expect(diffEntities([kept, removed], [updated, added])).toEqual([
      {
        kind: 'UPDATED',
        entityType: 'grade_course',
        externalKey: 'CS101',
        fingerprint: updated.fingerprint,
        changedFields: [{ field: 'final', before: null, after: 9 }],
      },
      {
        kind: 'REMOVED',
        entityType: 'grade_course',
        externalKey: 'CS102',
        fingerprint: removed.fingerprint,
        changedFields: [{ field: 'final', before: 6 }],
      },
      {
        kind: 'ADDED',
        entityType: 'grade_course',
        externalKey: 'CS103',
        fingerprint: added.fingerprint,
        changedFields: [{ field: 'final', after: null }],
      },
    ]);
  });

  it('rejects snapshots that contain the same entity twice', async () => {
    const entity = await grade('CS101', { final: 8 });

    expect(() => diffEntities([], [entity, entity])).toThrow(/Duplicate entity/);
  });
});
