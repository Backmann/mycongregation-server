import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { EldersMeeting } from './elders-meeting.entity';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * What the body of elders has undertaken to do.
 *
 * The fields are deliberately few, and each was argued for:
 *
 * - WHOM is optional. Much is decided by the body rather than by a person, and
 *   demanding an assignee at the moment of writing breeds fictional ones — the
 *   coordinator's name against everything.
 * - BY WHEN is optional too, but it is what makes a task surface on its own
 *   later; without it nothing will remind anybody.
 * - AREA comes from a short closed list. Free text turns into a heap of
 *   synonyms within a month; ten categories turn every entry into an agonising
 *   choice.
 * - STATE is only open or done. There is no «in progress» because the
 *   congregation has no such process, and a state nobody means forces people
 *   to lie to the form.
 *
 * TEXT IS ENCRYPTED. This is the most sensitive material in the app — «care
 * for publishers in special circumstances» is more revealing than any address
 * or telephone number. It lies unreadable in the database, so a stolen copy
 * discloses nothing, and the same transformer already guards the journal.
 */
export type TaskArea =
  | 'ministry'
  | 'teaching'
  | 'care'
  | 'organisation'
  | 'accounts'
  | 'other';

@Entity('elder_tasks')
@Index(['congregationId', 'status'])
@Index(['congregationId', 'eldersMeetingId'])
export class ElderTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'text', transformer: encryptedTransformer })
  title!: string;

  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  details!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'other' })
  area!: TaskArea;

  /** Optional on purpose — see the note above. */
  @Column({ type: 'uuid', nullable: true })
  assigneePublisherId!: string | null;

  @Column({ type: 'date', nullable: true })
  dueDate!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'open' })
  status!: 'open' | 'done';

  @Column({ type: 'timestamptz', nullable: true })
  doneAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  doneById!: string | null;

  /**
   * The meeting this is going to. Null means it is on the list but not yet
   * put on any agenda.
   *
   * `onDelete: SET NULL` because cancelling a meeting must not delete the work
   * that was going to be discussed at it.
   */
  @Column({ type: 'uuid', nullable: true })
  eldersMeetingId!: string | null;

  @ManyToOne(() => EldersMeeting, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'elders_meeting_id' })
  eldersMeeting?: EldersMeeting | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
