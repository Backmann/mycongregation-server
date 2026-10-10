import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ServiceGroup } from './service-group.entity';

export const CONDUCTOR_RULES = ['group_overseer', 'rotation', 'none'] as const;
export type ConductorRule = (typeof CONDUCTOR_RULES)[number];

/**
 * One recurring meeting of a congregation's field-service template, e.g.
 * «1st and 3rd Saturday · 10:00 · the Werne group · its overseer conducts».
 * The generator turns each slot into real meetings on the matching days of
 * each month. Edited as a whole set (replace-all); `position` preserves
 * display order.
 *
 * Since October 2026 a slot says WHICH Saturdays (`ordinals`, or the last
 * one), WHOSE meeting it is (`serviceGroupId`, null for everybody), WHERE
 * (`address`, or the group's own place when null) and WHO CONDUCTS
 * (`conductorRule`). `ordinal` is the first of `ordinals`, kept for an app
 * that knows only the old shape.
 */
@Entity('field_service_template_slots')
@Index(['congregationId'])
export class FieldServiceTemplateSlot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'int' })
  position!: number;

  /** First of `ordinals` (5 when only the last is meant) — the old shape. */
  @Column({ type: 'int', comment: 'Nth occurrence in the month, 1-5' })
  ordinal!: number;

  /** Which occurrences of the weekday, 1–5; all five means «every». */
  @Column({ type: 'smallint', array: true, default: () => "'{}'" })
  ordinals!: number[];

  /** The last occurrence of the weekday in the month, whatever its number. */
  @Column({ type: 'boolean', default: false })
  lastOnly!: boolean;

  @Column({ type: 'int', comment: '1=Mon .. 7=Sun' })
  dayOfWeek!: number;

  @Column({ type: 'varchar', length: 5, comment: '"HH:MM" 24h' })
  startTime!: string;

  /** Null: the group's own meeting place. Required for a general meeting. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  /** Whose meeting. Null: for the whole congregation. */
  @Column({ type: 'uuid', nullable: true })
  serviceGroupId!: string | null;

  @ManyToOne(() => ServiceGroup, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'service_group_id' })
  serviceGroup?: ServiceGroup | null;

  @Column({ type: 'varchar', length: 20, default: 'none' })
  conductorRule!: ConductorRule;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
