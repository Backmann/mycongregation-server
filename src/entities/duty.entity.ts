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
import { Publisher } from './publisher.entity';
import { EventType } from '../common/enums/event-type.enum';
import { DutyType } from '../common/enums/duty-type.enum';

/**
 * A single meeting-duty slot for one congregation, week and meeting. Mirrors the
 * Assignment keying: (congregationId, weekStartDate=Monday, eventType). Duties
 * only apply to the midweek and weekend meetings.
 *
 * A row exists per slot: single-slot duties use slotIndex 0; MICROPHONE uses
 * slots 0..microphoneSlots-1; CUSTOM uses an incrementing slotIndex. The unique
 * constraint keeps generation idempotent.
 */
@Entity('duties')
@Unique('uq_duty_slot', [
  'congregationId',
  'weekStartDate',
  'eventType',
  'dutyType',
  'slotIndex',
])
@Index(['congregationId', 'weekStartDate', 'eventType'])
@Index(['congregationId', 'publisherId'])
export class Duty {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Time / event ----
  @Column({
    type: 'date',
    comment: 'Monday of the ISO week (frontend normalizes to Monday)',
  })
  weekStartDate!: string;

  @Column({
    type: 'varchar',
    length: 16,
    comment: 'midweek | weekend (duties only apply to these two meetings)',
  })
  eventType!: EventType;

  // ---- Duty identity ----
  @Column({
    type: 'varchar',
    length: 32,
    comment:
      'security | attendant | microphone | av | zoom | ' +
      'stage | ventilation | custom',
  })
  dutyType!: DutyType;

  @Column({
    type: 'integer',
    default: 0,
    comment: 'Slot within the duty type (0 for single-slot; 0..N-1 for mics)',
  })
  slotIndex!: number;

  /**
   * Where this duty sits on the sheet — moved by hand.
   *
   * The order used to be WORKED OUT rather than kept: by kind of duty, then by
   * slot. Nothing could be moved, because there was nowhere to write down that
   * one place now comes before another. A congregation meeting in a rented
   * room, or holding the Memorial, wants its own order and no fixed list of
   * kinds can guess it.
   *
   * Rows of ONE place share a value: «Стоянка» is three rows, and they move
   * together — the number inside a place means nothing to anybody.
   */
  @Column({
    type: 'integer',
    default: 0,
    name: 'sort_order',
    comment: 'Position on the sheet; rows of one place share it',
  })
  sortOrder!: number;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'Free-text label for one-week CUSTOM duties; null otherwise',
  })
  customLabel!: string | null;

  // ---- Assignment ----
  @Column({ type: 'uuid', nullable: true })
  publisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // ---- Standard ----
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
