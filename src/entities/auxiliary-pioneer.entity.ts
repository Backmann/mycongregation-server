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
import { Publisher } from './publisher.entity';

/**
 * A period during which a publisher serves as an auxiliary pioneer (Служение →
 * Подсобное пионерское служение). One row = one publisher + a start month and
 * an optional end month. `untilCancelled = true` (endMonth null) means the
 * person serves indefinitely until stopped.
 *
 * The hour goal is NOT stored here — it is computed per month (15 in
 * March/April, the month(s) of a circuit-overseer visit and the Memorial
 * month; 30 otherwise), so it always reflects the current calendar and events.
 *
 * Months are stored as first-of-month dates (YYYY-MM-01) for easy range
 * comparisons. Only baptized publishers may hold this — enforced in the service.
 */
@Entity('auxiliary_pioneers')
@Index(['congregationId', 'publisherId'])
@Index(['congregationId', 'startMonth'])
export class AuxiliaryPioneer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  publisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher;

  /** First month of service, stored as YYYY-MM-01. */
  @Column({ type: 'date', name: 'start_month' })
  startMonth!: string;

  /**
   * Last month of service (inclusive), YYYY-MM-01, or null when the person
   * serves "until cancelled".
   */
  @Column({ type: 'date', name: 'end_month', nullable: true })
  endMonth!: string | null;

  /** True when there is no fixed end — serves until explicitly stopped. */
  @Column({ type: 'boolean', name: 'until_cancelled', default: false })
  untilCancelled!: boolean;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
