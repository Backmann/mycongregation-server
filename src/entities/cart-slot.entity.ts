import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { CartWeek } from './cart-week.entity';
import { CartLocation } from './cart-location.entity';
import { CartRequest } from './cart-request.entity';

/**
 * A single witnessing slot: one day, one time window, one location, within a
 * cart_week grid. Staffed by 2-4 publishers (enforced when assigning, Phase 3).
 */
@Entity('cart_slots')
@Index(['congregationId', 'date'])
@Index(['weekId'])
export class CartSlot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  weekId!: string;

  @ManyToOne(() => CartWeek, (w) => w.slots, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'week_id' })
  week!: CartWeek;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 5 })
  startTime!: string;

  @Column({ type: 'varchar', length: 5 })
  endTime!: string;

  @Column({ type: 'uuid' })
  locationId!: string;

  @ManyToOne(() => CartLocation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'location_id' })
  location!: CartLocation;

  /**
   * Called off by whoever arranges the shifts — bad weather, an unsafe day in
   * town. The crew stays as it was, so the shift can be put back.
   */
  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  /** Optional and short: «непогода». Shown to the crew. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  cancelReason!: string | null;

  @Column({ type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @OneToMany(() => CartRequest, (r) => r.slot)
  requests!: CartRequest[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
