import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Receipt for a single push notification message sent via the Expo Push API.
 *
 * Flow:
 *   1. send → Expo returns a "ticket" (an opaque id we store here with status='pending')
 *   2. ~15-30 min later, a cron fetches the "receipt" for each pending ticket
 *      and updates status to 'ok' or 'error' (with errorCode such as
 *      DeviceNotRegistered, MessageRateExceeded, etc.)
 *   3. DeviceNotRegistered triggers cleanup of the corresponding push_tokens row.
 *   4. After several days, processed receipts are deleted.
 *
 * No FK to push_tokens — tokens may be deleted as part of cleanup, and we want
 * receipts to survive that for short-term audit.
 */
@Entity('push_receipts')
@Index(['status', 'sentAt'])
@Index(['token'])
@Index(['congregationId'])
export class PushReceipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  ticketId!: string;

  @Column({ type: 'varchar', length: 255 })
  token!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'pending',
    comment: 'Lifecycle: pending | ok | error',
  })
  status!: 'pending' | 'ok' | 'error';

  @Column({ type: 'varchar', length: 64, nullable: true })
  errorCode!: string | null;

  @Column({ type: 'timestamptz' })
  sentAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  checkedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
