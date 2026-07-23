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

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', name: 'recorded_by', nullable: true })
  recordedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
