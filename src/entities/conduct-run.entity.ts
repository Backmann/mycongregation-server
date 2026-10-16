import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Congregation } from './congregation.entity';

/**
 * How one midweek meeting actually ran — the chairman's run sheet with the
 * minutes each part took (14 October 2026).
 *
 * Until now the run lived on the chairman's tablet only, and nothing was left
 * to look at once he closed the screen. Lionel wanted the elders to be able to
 * see, after the meeting, who had how much time — and decided how long that
 * may stay: SEVEN DAYS, then it is deleted. It is a view of people's parts
 * against the clock, and nothing the congregation keeps.
 *
 * So:
 *  - one row per meeting, replaced if the chairman finishes it again;
 *  - read by the chairman of that week, the elders and an admin, and only
 *    while it is younger than seven days (ConductRunsService.find);
 *  - deleted every night once older (ScheduledJobsService);
 *  - never written to the audit log (it would outlive the seven days there)
 *    and never copied into the anonymised copy (anon-copy/plan.ts: skip).
 *
 * `segments` is what the screen walked: per part its key, the programme row,
 * who took it AT THE TIME (a reassignment later must not move the minutes
 * onto somebody else), the programme's own minutes and the seconds it took.
 */
export interface ConductRunSegment {
  key: string;
  assignmentId: string | null;
  publisherIds: string[];
  /** The part's own minutes, in seconds — the counsel minute not included. */
  plannedSec: number;
  actualSec: number;
  /** After a student part: the seconds until the next part began (counsel). */
  counselSec: number | null;
  /**
   * When the part began, seconds from the meeting's start (16 October 2026)
   * — where the pauses between parts fell. Absent in results saved before.
   */
  startSec?: number | null;
}

@Entity('conduct_runs')
@Unique(['congregationId', 'weekStartDate', 'eventType'])
@Index(['savedAt'])
export class ConductRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'congregation_id' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  /** The Monday of the meeting's week. */
  @Column({ type: 'date', name: 'week_start_date' })
  weekStartDate!: string;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'event_type',
    default: 'midweek',
  })
  eventType!: string;

  @Column({ type: 'jsonb' })
  segments!: ConductRunSegment[];

  /** Wall-clock seconds from the first part to «Завершить», pauses included. */
  @Column({ type: 'integer', name: 'total_sec' })
  totalSec!: number;

  /** The programme's minutes for the whole meeting, in seconds. */
  @Column({ type: 'integer', name: 'planned_sec' })
  plannedSec!: number;

  /** When the first part began (16 October 2026); null in older results. */
  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'uuid', name: 'saved_by', nullable: true })
  savedBy!: string | null;

  /** The seven days run from here. Set on every save. */
  @Column({ type: 'timestamptz', name: 'saved_at' })
  savedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
