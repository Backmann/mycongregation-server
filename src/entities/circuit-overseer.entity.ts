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
import { Congregation } from './congregation.entity';

/**
 * A circuit overseer (or a substitute) the congregation may host. There can be
 * several per congregation — the regular overseer plus any substitutes — with
 * exactly one marked primary (pre-filled when creating a visit). Names show on
 * a public week banner (not personal publisher data), so they are stored in
 * plain text. A visit event keeps its own name snapshot, so editing a record
 * later never rewrites the names of past visits.
 */
export type CircuitOverseerRole = 'overseer' | 'substitute';

@Entity('circuit_overseers')
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

  /** Whether this entry is the regular overseer or a substitute. */
  @Column({ type: 'varchar', length: 20, default: 'overseer' })
  role!: CircuitOverseerRole;

  /** Exactly one record per congregation is the primary (pre-fill default). */
  @Column({ type: 'boolean', default: false })
  isPrimary!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
