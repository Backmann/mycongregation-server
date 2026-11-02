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
 * The four kinds of equipment the branch offers (S-80): a cart, a stand, a
 * kiosk on wheels and a table.
 */
export type CartLocationKind = 'cart' | 'stand' | 'kiosk' | 'table';
export const CART_LOCATION_KINDS: CartLocationKind[] = [
  'cart',
  'stand',
  'kiosk',
  'table',
];

/**
 * A public-witnessing point of one congregation — a cart ("тележка") or a
 * stand ("стенд") at a given address. Used as a quick-pick when building the
 * weekly witnessing grid. A point can be deactivated (isActive=false) instead
 * of deleted so historical references stay intact.
 */
@Entity('cart_locations')
@Index(['congregationId'])
export class CartLocation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address!: string | null;

  @Column({
    type: 'varchar',
    length: 8,
    default: 'cart',
    comment: "'cart' | 'stand' | 'kiosk' | 'table'",
  })
  kind!: CartLocationKind;

  /**
   * Where the equipment is fetched from — the service committee decides where
   * it is kept. Shown with every shift at this place.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  equipmentAt!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
