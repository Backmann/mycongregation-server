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

/**
 * Effective-dated meeting schedule for a congregation. Each row is a version
 * that applies from `effectiveFrom` onward; the version in force for a given
 * date is the one with the greatest effectiveFrom <= that date. Editing the
 * schedule (day/time/place changes) creates a new version, so past weeks keep
 * their then-current values.
 *
 * The congregation name and timezone live on the Congregation entity (they are
 * not effective-dated).
 */
@Entity('meeting_settings')
@Unique('uq_meeting_settings_cong_effective', [
  'congregationId',
  'effectiveFrom',
])
@Index(['congregationId', 'effectiveFrom'])
export class MeetingSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({
    type: 'date',
    comment: 'These settings apply from this date onward',
  })
  effectiveFrom!: string;

  // ---- Midweek meeting ----
  @Column({ type: 'smallint', comment: 'ISO weekday 1=Mon..7=Sun' })
  midweekDow!: number;

  @Column({ type: 'varchar', length: 5, comment: 'Local wall-clock HH:mm' })
  midweekTime!: string;

  // ---- Weekend meeting ----
  @Column({ type: 'smallint', comment: 'ISO weekday 1=Mon..7=Sun' })
  weekendDow!: number;

  @Column({ type: 'varchar', length: 5, comment: 'Local wall-clock HH:mm' })
  weekendTime!: string;

  // ---- Place ----
  @Column({
    type: 'text',
    comment: 'Kingdom Hall address (shared by both meetings)',
  })
  address!: string;

  // ---- Duties config ----
  @Column({
    type: 'smallint',
    default: 2,
    comment: 'Number of microphone duty slots for this congregation',
  })
  microphoneSlots!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
