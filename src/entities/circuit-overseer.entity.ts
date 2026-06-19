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
 * The congregation's current circuit overseer — a single record per
 * congregation used to pre-fill a circuit-overseer-visit event. Names are
 * shown on a public week banner (not personal publisher data), so they are
 * stored in plain text. A visit event keeps its own name snapshot, so editing
 * this default never rewrites the names of past visits.
 */
@Entity('circuit_overseers')
@Unique('uq_circuit_overseer_congregation', ['congregationId'])
export class CircuitOverseer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ type: 'varchar', length: 100 })
  lastName!: string;

  /** The overseer's wife, when he is married (optional). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  wifeName!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
