import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { EldersMeeting } from './elders-meeting.entity';
import { Publisher } from './publisher.entity';
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
// The list itself lives in src/tasks/task-areas.ts, with the database's own
// CHECK constraints guarded by a test against it. Imported and re-exported
// here because every reader of this entity expects the type beside the column
// it types.
import type { TaskArea } from '../tasks/task-areas';
export type { TaskArea };

/**
 * Whom the task is for.
 *
 * «people» carries names; the other two carry none and are resolved from
 * current responsibilities each time they are read — an assignment can change
 * hands, and the task follows the office rather than the person who held it
 * when it was written.
 */
export type TaskAssigneeKind =
  | 'people'
  | 'service_committee'
  | 'body_of_elders';

/** The recurring things the app puts on the calendar itself. */
export type TaskKind =
  | 'accounts_audit'
  | 'pioneer_service_review'
  | 'service_year_review'
  // Not from the calendar like the three above: raised when a group has gone
  // a service year without a visit, and lowered when one is planned. Lives in
  // field-service-meetings, the module that knows what a visit is.
  | 'service_overseer_visits';

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
  /**
   * Kept for what was written before assignees became a list, and still
   * written alongside it so nothing that reads the old field breaks.
   */
  @Column({ type: 'uuid', nullable: true })
  assigneePublisherId!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'people' })
  assigneeKind!: TaskAssigneeKind;

  /**
   * The named brothers, when the kind is «people». Empty for the other two —
   * their members are looked up, not stored.
   */
  @ManyToMany(() => Publisher)
  @JoinTable({
    name: 'elder_task_assignees',
    joinColumn: { name: 'task_id' },
    inverseJoinColumn: { name: 'publisher_id' },
  })
  assignees!: Publisher[];

  /** «19:00» — what «two hours before» counts back from. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  dueTime!: string | null;

  /** Set only on tasks the app created; null on everything a person wrote. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  kind!: TaskKind | null;

  /** Which turn of it — «2026-Q3», «2026» — so a period is created once. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  kindPeriod!: string | null;

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
