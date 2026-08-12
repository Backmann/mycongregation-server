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
import { EldersMeeting } from './elders-meeting.entity';
import { Publisher } from './publisher.entity';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/** What became of an item once it was discussed. */
export type ItemOutcome = 'reviewed' | 'carried' | 'task';

/**
 * A question on the agenda: what it is, where it comes from, who presents it,
 * how long it should take, and what was decided.
 *
 * The TITLE AND THE NOTE ARE ENCRYPTED, with the same transformer the journal
 * uses. This is the most revealing material in the app — more so than any
 * address — and it lies unreadable in the database, so a stolen copy discloses
 * nothing.
 */
@Entity('elders_meeting_items')
@Index(['congregationId', 'meetingId', 'position'])
export class EldersMeetingItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  /** Null while it waits: the first meeting created picks it up. */
  @Column({ type: 'uuid', nullable: true })
  meetingId!: string | null;

  @ManyToOne(() => EldersMeeting, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'meeting_id' })
  meeting!: EldersMeeting | null;

  /** Order on the sheet; «третий вопрос» has to mean something. */
  @Column({ type: 'integer', default: 0 })
  position!: number;

  @Column({ type: 'text', transformer: encryptedTransformer })
  title!: string;

  /** «km 3/24, стр. 5» — as written. */
  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  sourceText!: string | null;

  @Column({ type: 'text', nullable: true })
  sourceUrl!: string | null;

  @Column({ type: 'uuid', nullable: true })
  presenterPublisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'presenter_publisher_id' })
  presenter!: Publisher | null;

  /** Ten by default — an empty column would make the total lie. */
  @Column({ type: 'integer', default: 10 })
  minutes!: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  outcome!: ItemOutcome | null;

  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  outcomeNote!: string | null;

  /**
   * The task it became. SET NULL rather than cascade: deleting the task must
   * not erase the record that something was decided here.
   */
  @Column({ type: 'uuid', nullable: true })
  taskId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
