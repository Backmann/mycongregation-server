import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One notification for one person, on its way out.
 *
 * Every automatic notification is written here before it is sent, which buys
 * three things at once:
 *
 *  - **It is sent once.** A `dedupeKey` makes a repeat impossible, so a
 *    restarted container, a retried tick or two racing jobs cannot say the
 *    same thing twice. The cleaning reminders already worked this way; this
 *    is that idea, generalised.
 *  - **It waits for a decent hour.** When it falls outside the congregation's
 *    waking hours the row keeps a `notBefore` and is delivered in the morning
 *    instead of at four.
 *  - **It can be counted.** What was sent, to whom, when, and of what kind —
 *    which is the only way to tell whether the notifications are getting
 *    quieter or noisier.
 */
@Entity('notification_outbox')
export class NotificationOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_notification_outbox_congregation')
  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  data!: Record<string, any>;

  /**
   * What kind of notification this is (`report_reminder`, `cleaning`, …).
   * Kept as its own column so volume can be read per kind without digging
   * through the payload.
   */
  @Column({ type: 'varchar', length: 48 })
  kind!: string;

  /**
   * Identifies the thing being announced, so it is announced once. Null for
   * notifications that may legitimately repeat.
   */
  @Column({ type: 'varchar', length: 96, nullable: true })
  dedupeKey!: string | null;

  /** Earliest moment this may go out; null means "as soon as possible". */
  @Index('idx_notification_outbox_not_before')
  @Column({ type: 'timestamptz', nullable: true })
  notBefore!: Date | null;

  /**
   * pending → what became of it:
   *   sent      — a device took it (`channel` says which kind);
   *   no_device — the person has no phone token and no browser subscription,
   *               so there was nowhere to send. Until October 2026 these rows
   *               read «sent» too, and four in ten of them had gone nowhere;
   *   failed    — there was a device and nothing got through.
   */
  @Index('idx_notification_outbox_status')
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: 'pending' | 'sent' | 'no_device' | 'failed';

  /**
   * Which road carried it: the phone app, a browser — or a letter, for a
   * notification marked `emailFallback` whose owner has no device at all.
   * Null unless sent.
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  channel!: 'phone' | 'web' | 'email' | null;

  /** With nowhere to send it, this one goes by e-mail instead. */
  @Column({ type: 'boolean', default: false })
  emailFallback!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;
}
