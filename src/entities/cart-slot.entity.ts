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

  @OneToMany(() => CartRequest, (r) => r.slot)
  requests!: CartRequest[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
