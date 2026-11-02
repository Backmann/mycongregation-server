import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { CartWeek } from './cart-week.entity';
import { CartLocation } from './cart-location.entity';

/**
 * A place on a date with its hours — «четверг, Ahlen, 07:00–16:00»
 * (2 November 2026). People sign up for a span of it, from — to on the
 * half-hour; whoever arranges puts them on the plan for a span of it.
 */
@Entity('cart_days')
@Unique('uq_cart_day_week_date_location', ['weekId', 'date', 'locationId'])
@Index(['congregationId', 'date'])
export class CartDay {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  weekId!: string;

  @ManyToOne(() => CartWeek, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'week_id' })
  week!: CartWeek;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'uuid' })
  locationId!: string;

  @ManyToOne(() => CartLocation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'location_id' })
  location!: CartLocation;

  @Column({ type: 'varchar', length: 5 })
  startTime!: string;

  @Column({ type: 'varchar', length: 5 })
  endTime!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
