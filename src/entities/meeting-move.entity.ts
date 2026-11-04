import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';

/**
 * A meeting moved for ONE week to another day or hour of that same week
 * (4 November 2026 — Lionel: it happens now and then, apart from the circuit
 * overseer's visit).
 *
 * One row per meeting per week, held by the database itself: a second move of
 * the same meeting replaces the first rather than standing beside it, and
 * moving it back removes the row. The day stays inside its own week (a check
 * constraint), so the meeting keeps its programme, its duties and its
 * attendance row — only its day, hour and place change. The week rules
 * (common/week-rules.ts) are the one reader; nothing else asks this table
 * which day a meeting is on.
 */
@Entity('meeting_moves')
@Unique('uq_meeting_move_week_kind', [
  'congregationId',
  'weekStartDate',
  'eventType',
])
export class MeetingMove {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'date', comment: 'Monday of the ISO week' })
  weekStartDate!: string;

  @Column({ type: 'varchar', length: 10, comment: "'midweek' | 'weekend'" })
  eventType!: 'midweek' | 'weekend';

  @Column({ type: 'date', comment: 'The day it is held instead' })
  date!: string;

  @Column({ type: 'varchar', length: 5, comment: '"HH:MM" start' })
  time!: string;

  /** Null: at the Kingdom Hall, as the settings give it. */
  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'uuid', nullable: true })
  movedById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
