import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * Append-only log of changes to auditable entities.
 *
 * Append-only is meant literally: nothing in the application edits or deletes
 * a row. Only two things ever remove content — the nightly retention job,
 * which drops entries past a year, and an erasure request, which empties a
 * row's values while leaving the row. A journal an administrator can edit
 * proves nothing on the day it is needed.
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
@Index(['congregationId', 'subjectId'])
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

  /** Null when nobody human acted — see `source`. */
  @Column({ type: 'uuid', nullable: true, name: 'actor_user_id' })
  actorUserId!: string | null;

  /**
   * 'user' when a person did it, 'system' for the scheduled jobs, imports and
   * syncs that run with nobody signed in. Explicit, because a null actor
   * without a reason cannot be told apart from a missing one.
   */
  @Column({ type: 'varchar', length: 16, default: 'user' })
  source!: 'user' | 'system';

  /**
   * Whom the entry is ABOUT, when that is not the actor: the brother whose
   * report the secretary entered, the publisher whose card an elder edited.
   * Null when actor and subject are the same person.
   */
  @Column({ type: 'uuid', nullable: true, name: 'subject_id' })
  subjectId!: string | null;

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

  /**
   * Set when the values were cleared at the request of the person they
   * concerned. The entry stays — who did what and when is the congregation's
   * record — but its personal contents are gone.
   */
  @Column({ type: 'timestamptz', nullable: true, name: 'redacted_at' })
  redactedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
