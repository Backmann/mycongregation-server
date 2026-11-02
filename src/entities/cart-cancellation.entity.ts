import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { CartDay } from './cart-day.entity';

/**
 * A day at the stand, or part of it, called off — bad weather, an unsafe day
 * in town (Lionel, 2 November 2026). The plan underneath stays as it was;
 * removing this row puts the day back.
 */
@Entity('cart_cancellations')
@Index(['dayId'])
export class CartCancellation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  dayId!: string;

  @ManyToOne(() => CartDay, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'day_id' })
  day!: CartDay;

  @Column({ type: 'varchar', length: 5 })
  startTime!: string;

  @Column({ type: 'varchar', length: 5 })
  endTime!: string;

  /** Optional and short — «непогода». Said to the people it concerns. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  reason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
