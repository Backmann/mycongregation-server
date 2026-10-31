import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { EventType } from '../common/enums/event-type.enum';

export const NOT_HELD_REASONS = ['weather', 'hall', 'other'] as const;
export type NotHeldReason = (typeof NOT_HELD_REASONS)[number];

/**
 * Attendance at one meeting — form S-3, «Отчёт о посещаемости встреч».
 *
 * The figure counts EVERYONE present: publishers, unbaptized, children,
 * visitors from other congregations, guests. It is one number per meeting, not
 * a record about any person, which is why it lives apart from publishers.
 *
 * Keyed by the meeting's own calendar DATE rather than by the week it belongs
 * to: the form is organised by calendar month, a week can straddle two months,
 * and a circuit overseer's visit moves a meeting to a different day. The date
 * survives all three.
 */
@Entity('meeting_attendance')
@Unique(['congregationId', 'date', 'eventType'])
@Index(['congregationId', 'date'])
export class MeetingAttendance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'congregation_id' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  /** The meeting's own date, not the Monday of its week. */
  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 16, name: 'event_type' })
  eventType!: EventType;

  /**
   * Everyone present. Null only when the meeting was not held — the check
   * constraint keeps those two states from ever being mixed.
   */
  @Column({ type: 'integer', nullable: true })
  count!: number | null;

  /**
   * The meeting did not take place: an assembly, a convention, the Memorial
   * elsewhere. Distinct from "nobody has entered it yet", and the difference
   * decides the monthly average — it divides by meetings actually HELD.
   */
  @Column({ type: 'boolean', name: 'not_held', default: false })
  notHeld!: boolean;

  /**
   * The part of `count` that joined by video (31 October 2026). Kept «для
   * понимания»: what goes into every form is `count`, the sum. Null when
   * nobody said — older rows, or a congregation without a video link.
   */
  @Column({ type: 'integer', nullable: true, name: 'online_count' })
  onlineCount!: number | null;

  /** Why a meeting was not held: 'weather' | 'hall' | 'other'. */
  @Column({
    type: 'varchar',
    length: 16,
    nullable: true,
    name: 'not_held_reason',
  })
  notHeldReason!: NotHeldReason | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', name: 'recorded_by', nullable: true })
  recordedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
