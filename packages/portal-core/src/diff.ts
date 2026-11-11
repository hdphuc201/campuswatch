import type {
  CanonicalValue,
  ChangeKind,
  EntityType,
  NormalizedEntity,
} from '@campuswatch/contracts';
import { canonicalEntries } from './canonical.js';

export interface FieldChange {
  readonly field: string;
  /** Absent when the field did not exist before. */
  readonly before?: CanonicalValue;
  /** Absent when the field no longer exists. */
  readonly after?: CanonicalValue;
}

export interface EntityChange {
  readonly kind: ChangeKind;
  readonly entityType: EntityType;
  readonly externalKey: string;
  /** Fingerprint of the new state, or of the last known state for `REMOVED`. */
  readonly fingerprint: string;
  readonly changedFields: readonly FieldChange[];
}

const entityKey = (entity: NormalizedEntity): string =>
  `${entity.entityType}\u0000${entity.externalKey}`;

function indexByKey(entities: readonly NormalizedEntity[]): Map<string, NormalizedEntity> {
  const index = new Map<string, NormalizedEntity>();
  for (const entity of entities) {
    const key = entityKey(entity);
    if (index.has(key)) {
      throw new Error(`Duplicate entity in snapshot: ${entity.entityType}/${entity.externalKey}`);
    }
    index.set(key, entity);
  }
  return index;
}

function diffFields(previous?: NormalizedEntity, next?: NormalizedEntity): FieldChange[] {
  const before = new Map(previous ? canonicalEntries(previous.payload) : []);
  const after = new Map(next ? canonicalEntries(next.payload) : []);
  const fields = [...new Set([...before.keys(), ...after.keys()])].sort();

  return fields.flatMap((field): FieldChange[] => {
    const hadField = before.has(field);
    const hasField = after.has(field);
    const oldValue = before.get(field);
    const newValue = after.get(field);
    if (hadField && hasField && Object.is(oldValue, newValue)) {
      return [];
    }
    return [
      {
        field,
        ...(hadField ? { before: oldValue } : {}),
        ...(hasField ? { after: newValue } : {}),
      },
    ];
  });
}

/**
 * Compares two snapshots of the same connection and adapter. Entities are matched by
 * `entityType + externalKey`, so row order never produces a change, and the output is
 * sorted for deterministic results.
 *
 * Initial implementation; P5 builds persistence and idempotency keys on top of it.
 */
export function diffEntities(
  previous: readonly NormalizedEntity[],
  next: readonly NormalizedEntity[],
): EntityChange[] {
  const before = indexByKey(previous);
  const after = indexByKey(next);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: EntityChange[] = [];

  for (const key of keys) {
    const oldEntity = before.get(key);
    const newEntity = after.get(key);
    const reference = newEntity ?? oldEntity;
    if (!reference) {
      continue;
    }

    let kind: ChangeKind;
    if (!oldEntity) {
      kind = 'ADDED';
    } else if (!newEntity) {
      kind = 'REMOVED';
    } else if (oldEntity.fingerprint !== newEntity.fingerprint) {
      kind = 'UPDATED';
    } else {
      continue;
    }

    changes.push({
      kind,
      entityType: reference.entityType,
      externalKey: reference.externalKey,
      fingerprint: reference.fingerprint,
      changedFields: diffFields(oldEntity, newEntity),
    });
  }

  return changes;
}
