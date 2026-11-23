import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';

/** One meeting's number for a measure, by the week it belongs to. */
export interface ConductAverageValue {
  week: string;
  v: number;
}

/**
 * What the forecast of a running meeting learns from the meetings before it
 * (R-76, 22 November 2026): the last twelve meetings' numbers of one measure
 * — seconds, nothing else. No names and no results: those go on the 4th day
 * (conduct-runs), these stay, so the forecast need not count a song with its
 * prayer as the programme's five minutes when it ran three.
 */
@Entity('conduct_averages')
@Unique(['congregationId', 'eventType', 'measure'])
export class ConductAverage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'congregation_id' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'varchar', length: 16, name: 'event_type' })
  eventType!: string;

  /** prayer · songLead · walk · counsel (conduct-runs/conduct-averages.ts). */
  @Column({ type: 'varchar', length: 20 })
  measure!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  values!: ConductAverageValue[];

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
