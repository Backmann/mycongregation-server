import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Idempotency ledger for cron-sent reminders. A row's presence means the
 * reminder identified by (congregationId, kind, key) was already sent.
 */
@Entity('reminder_log')
@Unique('uq_reminder_log_cong_kind_key', ['congregationId', 'kind', 'key'])
export class ReminderLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'varchar', length: 48 })
  kind!: string;

  @Column({ type: 'varchar', length: 64 })
  key!: string;

  @Index('idx_reminder_log_sent_at')
  @CreateDateColumn({ type: 'timestamptz' })
  sentAt!: Date;
}
