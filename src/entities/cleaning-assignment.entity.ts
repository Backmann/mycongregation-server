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
import { ServiceGroup } from './service-group.entity';
import { CleaningSlotType } from '../common/enums/cleaning-slot-type.enum';

/**
 * One cleaning slot for a congregation and week. At most one row per
 * (congregation, week, slotType). A missing row means the slot is unassigned.
 * For the GENERAL slot the row's presence is the marker; serviceGroupId is null.
 */
@Entity('cleaning_assignments')
@Unique('uq_cleaning_slot', ['congregationId', 'weekStartDate', 'slotType'])
@Index(['congregationId', 'weekStartDate'])
export class CleaningAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({
    type: 'date',
    comment: 'Monday of the ISO week (frontend normalizes to Monday)',
  })
  weekStartDate!: string;

  @Column({
    type: 'varchar',
    length: 24,
    comment: 'after_meeting | thorough | general',
  })
  slotType!: CleaningSlotType;

  @Column({ type: 'uuid', nullable: true })
  serviceGroupId!: string | null;

  /**
   * Hall-plan window numbers to wash this week. Meaningful only for the
   * THOROUGH slot; forced null for other slot types.
   */
  @Column({ type: 'int', array: true, nullable: true })
  windows!: number[] | null;

  /**
   * When the assigned group agreed to do the weekly thorough cleaning.
   * Optional — set by the cleaning coordinator or the group's overseer once
   * the group picks a day; drives the "2 hours before" push reminder.
   */
  @Column({ type: 'timestamptz', nullable: true })
  thoroughPlannedAt!: Date | null;

  @ManyToOne(() => ServiceGroup, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'service_group_id' })
  serviceGroup!: ServiceGroup | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
