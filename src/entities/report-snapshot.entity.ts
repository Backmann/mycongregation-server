import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { User } from './user.entity';

/**
 * WHAT WENT TO THE BRANCH, KEPT AS IT WENT.
 *
 * The figures for a finished period are worked out from the reports every time
 * they are opened, and the reports go on changing after the period is over: a
 * late report for August arrives on 3 September, a departure dated 1 September
 * is entered on the 27th. The annual report for 2025/26 was sent as 85 and by
 * the end of September the app said 84, then 86, and nobody could say any more
 * what had been sent. A row here is the answer to that: the figures as they
 * were sent, the people behind each of them, and when.
 *
 * `kind` 'annual' is the S-10 (period = the service year's first calendar
 * year, '2025' for 2025/26); 'monthly' is the S-1 (period = 'YYYY-MM').
 *
 * `confirmed` false means nobody saved what was sent and the app froze its own
 * figures when the deadline passed — a fact about the data, not about the
 * form, and the screens say so.
 */
@Entity('report_snapshots')
@Unique('uq_report_snapshots_cong_kind_period', [
  'congregationId',
  'kind',
  'period',
])
export class ReportSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'varchar', length: 10 })
  kind!: 'annual' | 'monthly';

  @Column({ type: 'varchar', length: 7 })
  period!: string;

  /** Saved by a person as what was sent (true), or frozen by the app (false). */
  @Column({ type: 'boolean', default: true })
  confirmed!: boolean;

  /** The day it went to the branch, when somebody said so. */
  @Column({ type: 'date', nullable: true })
  sentOn!: string | null;

  /** The figures as sent — numbers only, keyed as the form's lines. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  figures!: Record<string, number | null>;

  /**
   * Who stood behind each figure when it was sent — card ids only, never
   * names: a name changes, is erased on request, and has no business being
   * copied into a second place.
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  members!: Record<string, string[]>;

  /**
   * Each counted person's appointment when it was saved, by card id — so a
   * record card (S-21) for the closed year shows what they were in it, not
   * what they have become since.
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  appointments!: Record<string, string>;

  @Column({ type: 'uuid', nullable: true })
  savedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'saved_by_id' })
  savedBy!: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
