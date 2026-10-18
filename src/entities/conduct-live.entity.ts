import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';

/**
 * A midweek meeting WHILE IT RUNS — what the timekeeper's device last said,
 * for the chairman's iPad and the appointed brothers to watch (Lionel,
 * 15 October 2026).
 *
 * Not the result: that is conduct_runs, kept seven days. This row lives a day
 * and is deleted (scheduled-jobs), so nothing about the meeting stays here.
 *
 * ONE HAND AT A TIME. `controllerUserId` is the one account whose taps count;
 * `epoch` goes up every time somebody takes over. A write carrying an older
 * epoch is refused, so a timekeeper whose phone comes back online after the
 * chairman took over cannot overwrite the meeting with what he tapped in the
 * dark.
 *
 * `state` is the conduct screen's own run (app lib/conduct-run-record.ts),
 * stored as it is — the server does not interpret it, it only keeps it and
 * says who may change it. Its times are in SERVER time: every device
 * corrects its clock by the `serverNow` each answer carries.
 */
@Entity('conduct_live')
@Unique(['congregationId', 'weekStartDate', 'eventType', 'room'])
@Index(['updatedAt'])
export class ConductLive {
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

  /** The room: «main» — see entities/conduct-room.ts. */
  @Column({ type: 'varchar', length: 16, default: 'main' })
  room!: string;

  @Column({ type: 'jsonb' })
  state!: Record<string, unknown>;

  @Column({ type: 'integer', default: 1 })
  epoch!: number;

  @Column({ type: 'uuid', name: 'controller_user_id' })
  controllerUserId!: string;

  /**
   * WHICH DEVICE of that account taps (18 October 2026). The same brother
   * opened the meeting on his iPad and then on his phone; both were «his»,
   * both were heard, and the phone's old run overwrote the iPad's. Now one
   * device of the account runs it and the other watches until «Взять
   * ведение». Null — a row written by an app from before; then any device of
   * the account is heard, and the first that names itself is bound.
   */
  @Column({
    type: 'varchar',
    length: 64,
    name: 'controller_device_id',
    nullable: true,
  })
  controllerDeviceId!: string | null;

  /** The controller's device last asked — its sign of life. */
  @Column({ type: 'timestamptz', name: 'controller_seen_at' })
  controllerSeenAt!: Date;

  /** The chairman's device last asked, when he is not the controller. */
  @Column({ type: 'timestamptz', name: 'chairman_seen_at', nullable: true })
  chairmanSeenAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
