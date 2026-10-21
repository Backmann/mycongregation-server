import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * WHAT HAPPENS TO AN EDIT OF A PUBLISHED MEETING (21 October 2026).
 *
 * There used to be a button, «Уведомить», that nobody had to press: left
 * alone, it stood on the meeting for days (Lionel). Now the server says the
 * change by itself, ten minutes after the last edit (one, when the meeting is
 * less than three hours away), or at 18:00 when the editor chose «Отправить
 * вечером». One row per meeting holds that choice and what was last sent, for
 * the line on the meeting's card (assignments/programme-notice.service.ts).
 * The edits themselves are still the assignments' changedSincePublish flags.
 */
@Entity({ name: 'programme_notices' })
@Index(['congregationId', 'weekStartDate', 'eventType'], { unique: true })
export class ProgrammeNotice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'date' })
  weekStartDate!: string;

  @Column({ type: 'varchar', length: 16 })
  eventType!: string;

  /** «Отправить вечером»: nothing goes out before this moment. */
  @Column({ type: 'timestamptz', nullable: true })
  holdUntil!: Date | null;

  /** When the last change of this meeting was said, and to whom. */
  @Column({ type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  sentNames!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
