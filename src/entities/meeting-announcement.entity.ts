import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * ONE ANNOUNCEMENT, as it will be read aloud at one meeting (R-01, 24 November
 * 2026).
 *
 * The coordinator of the body of elders, his assistant or an administrator
 * writes it; the chairman of THAT meeting reads it — in the closing words on a
 * weekday, after the talk at the weekend. The meeting is named by its week and
 * kind, never by a date: the day a meeting falls on belongs to the week rules
 * (a visit, a move), and an announcement follows the meeting wherever it goes.
 *
 * THE TEXT IS ENCRYPTED, whatever it says (R-03): the council's delicate
 * announcements are kept whole like the others, so every one of them lies
 * unreadable in the database. It leaves 30 days after its week (retention),
 * and the journal records only that something was done — never the words.
 */
@Entity('meeting_announcements')
@Index(['congregationId', 'weekStartDate', 'eventType'])
// Named as its migration made it (1942): a generated name differed from
// the database's, and TypeORM 1.x generates yet another one.
@Index('UQ_meeting_announcements_source', ['congregationId', 'sourceKey'], {
  unique: true,
  where: '"source_key" IS NOT NULL',
})
export class MeetingAnnouncement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  /** Monday of the meeting's week. */
  @Column({ type: 'date' })
  weekStartDate!: string;

  /** 'midweek' | 'weekend'. */
  @Column({ type: 'varchar', length: 16 })
  eventType!: string;

  /** Order of reading within the meeting, from 1. */
  @Column({ type: 'integer', default: 1 })
  position!: number;

  @Column({ type: 'text', transformer: encryptedTransformer })
  text!: string;

  /** A letter pasted whole: the chairman sees it large, to scroll through. */
  @Column({ type: 'boolean', default: false })
  isLetter!: boolean;

  /**
   * Where it came from, for the small mark under it — «template», «task»,
   * «cleaning»… Null when a person simply wrote it.
   */
  @Column({ type: 'varchar', length: 40, nullable: true })
  source!: string | null;

  /**
   * What it was raised from, once only: «accounts_month:2026-11». A suggestion
   * the coordinator has taken is not offered again — the unique index holds
   * that even when two of them press «add» at the same moment.
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  sourceKey!: string | null;

  /**
   * The fingerprint of the dates and hours a suggestion's words were made
   * from (R-09). When the event changes, today's fingerprint differs and the
   * writers are told the text is stale. Null for anything written by hand.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  sourceFacts!: string | null;

  /**
   * Put on the chairman's list by the guidelines themselves, not by a person
   * (R-05): the assembly programme on the screens. Shown with its own mark.
   */
  @Column({ type: 'boolean', default: false })
  byRule!: boolean;

  /** Ticked off by the chairman as read aloud. */
  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  readByUserId!: string | null;

  /** «Убрать»: left unread at its meeting and let go by the coordinator. */
  @Column({ type: 'timestamptz', nullable: true })
  dismissedAt!: Date | null;

  /** The day of the meeting it was first meant for, when moved on unread. */
  @Column({ type: 'date', nullable: true })
  carriedFrom!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
