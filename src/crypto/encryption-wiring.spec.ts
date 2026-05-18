import { getMetadataArgsStorage, ValueTransformer } from 'typeorm';
import { encryptedTransformer } from './encrypted.transformer';
import { Publisher } from '../entities/publisher.entity';
import { ServiceReport } from '../entities/service-report.entity';
import { Family } from '../entities/family.entity';
import { ServiceGroup } from '../entities/service-group.entity';
import { AuditLog } from '../entities/audit-log.entity';

/**
 * Regression-protection for data-protection.md Phase 1.
 *
 * Asserts that every Tier 1 column listed in the design document has
 * encryptedTransformer attached to its TypeORM metadata. If someone removes
 * the transformer (intentionally or accidentally), this test fails loudly —
 * protecting against silent plaintext writes to columns the design promises
 * to keep encrypted at rest.
 *
 * Static check only: inspects compile-time decorator metadata. No database
 * connection, no NestJS bootstrap, no CryptoService initialization required.
 *
 * Tier 1 list per docs/architecture/data-protection.md:
 *   Publisher.{address, mobilePhone, email, notes, spiritualNotes, removedNote}
 *   ServiceReport.notes
 *   Family.notes
 *   ServiceGroup.notes
 *   AuditLog.{beforeJson, afterJson}  ← audit trail of encrypted entities
 *
 * Total: 11 columns across 5 entities.
 */

interface ExpectedField {
  entity: Function;
  entityName: string;
  property: string;
}

const TIER_1_FIELDS: ExpectedField[] = [
  // Publisher — 6 sensitive fields
  { entity: Publisher, entityName: 'Publisher', property: 'mobilePhone' },
  { entity: Publisher, entityName: 'Publisher', property: 'email' },
  { entity: Publisher, entityName: 'Publisher', property: 'address' },
  { entity: Publisher, entityName: 'Publisher', property: 'spiritualNotes' },
  { entity: Publisher, entityName: 'Publisher', property: 'notes' },
  { entity: Publisher, entityName: 'Publisher', property: 'removedNote' },

  // ServiceReport — 1
  { entity: ServiceReport, entityName: 'ServiceReport', property: 'notes' },

  // Family — 1
  { entity: Family, entityName: 'Family', property: 'notes' },

  // ServiceGroup — 1
  { entity: ServiceGroup, entityName: 'ServiceGroup', property: 'notes' },

  // AuditLog — 2 (mirror of changes to encrypted source records)
  { entity: AuditLog, entityName: 'AuditLog', property: 'beforeJson' },
  { entity: AuditLog, entityName: 'AuditLog', property: 'afterJson' },
];

describe('Encryption wiring (data-protection.md Phase 1)', () => {
  it.each(TIER_1_FIELDS)(
    '$entityName.$property uses encryptedTransformer',
    ({ entity, property }) => {
      const column = getMetadataArgsStorage().columns.find(
        (c) => c.target === entity && c.propertyName === property,
      );
      expect(column).toBeDefined();
      // ColumnOptions.transformer is ValueTransformer | ValueTransformer[].
      // We always wire a single transformer, so equality check is sufficient.
      const t = column?.options.transformer as ValueTransformer | undefined;
      expect(t).toBe(encryptedTransformer);
    },
  );

  it('covers exactly the Tier 1 list from data-protection.md (11 fields)', () => {
    // If this number ever changes intentionally, update both this assertion
    // AND the design document. The mismatch is a forcing function.
    expect(TIER_1_FIELDS).toHaveLength(11);
  });

  it('every Tier 1 entry has a distinct (entity, property) pair', () => {
    const keys = TIER_1_FIELDS.map((f) => `${f.entityName}.${f.property}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
