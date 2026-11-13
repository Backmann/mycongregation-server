import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { PlanPart } from '../territories/split';

/**
 * A territory divided between groups for one day (13 November 2026): which
 * streets each group walks. Tied to the assignment it was made under and
 * deleted with its marks when the territory comes back. The first division
 * of a day holds for everyone; doing it again replaces it.
 */
@Entity('territory_splits')
@Index('UQ_territory_splits_day', ['assignmentId', 'day'], { unique: true })
export class TerritorySplit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  territoryId!: string;

  @Column({ type: 'uuid' })
  assignmentId!: string;

  /** The congregation's own day it is for. */
  @Column({ type: 'date' })
  day!: string;

  @Column({ type: 'jsonb' })
  parts!: PlanPart[];

  /** Houses of the territory near no named street: in no part. */
  @Column({ type: 'integer', default: 0 })
  leftOut!: number;

  /** Who divided it: may do it again. Not shown to anyone. */
  @Column({ type: 'uuid', nullable: true })
  madeByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
