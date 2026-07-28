import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * A meeting of the body of elders.
 *
 * It exists so that a task has somewhere to be GOING. A list of tasks with no
 * occasion attached goes stale in a month — thirty entries are made, half fall
 * out of date, and nobody opens the page again. The body already has its own
 * rhythm, and this is it: a task is put on a particular meeting, and at that
 * meeting it is either closed or carries a new date.
 *
 * Keeping meetings as records of their own, rather than a bare «on the agenda»
 * flag, also buys history: six months on it is still visible what was
 * discussed on the fifth of August.
 */
@Entity('elders_meetings')
@Index(['congregationId', 'date'])
export class EldersMeeting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'date' })
  date!: string;

  /** Optional: many congregations settle the time only a few days ahead. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  startTime!: string | null;

  /**
   * Encrypted like everything else people write here. A note on an elders'
   * meeting can name a brother and his circumstances as readily as a task can.
   */
  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  note!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
