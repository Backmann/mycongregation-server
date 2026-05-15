import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * Append-only log of changes to auditable entities (currently ServiceReport).
 *
 * Storage notes:
 * - `beforeJson` / `afterJson` are JSON-serialised maps containing ONLY
 *   the changed fields. They go through `encryptedTransformer` because the
 *   source records they mirror (e.g. ServiceReport.notes) are encrypted at
 *   rest — keeping the audit log in plaintext would defeat that.
 * - `changedFields` is a plain text[] of field names — small,
 *   non-sensitive metadata used for fast filtering / display.
 */
@Entity('audit_logs')
@Index(['congregationId', 'entityType', 'entityId', 'createdAt'])
@Index(['congregationId', 'actorUserId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'congregation_id' })
  congregationId!: string;

  @Column({ type: 'varchar', length: 64, name: 'entity_type' })
  entityType!: string;

  @Column({ type: 'uuid', name: 'entity_id' })
  entityId!: string;

  @Column({ type: 'varchar', length: 32 })
  action!: string;

  @Column({ type: 'uuid', name: 'actor_user_id' })
  actorUserId!: string;

  @Column({
    type: 'text',
    nullable: true,
    name: 'before_json',
    transformer: encryptedTransformer,
  })
  beforeJson!: string | null;

  @Column({
    type: 'text',
    nullable: true,
    name: 'after_json',
    transformer: encryptedTransformer,
  })
  afterJson!: string | null;

  @Column({
    type: 'text',
    array: true,
    name: 'changed_fields',
    default: () => "'{}'::text[]",
  })
  changedFields!: string[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
