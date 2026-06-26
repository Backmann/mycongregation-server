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

export type CartLocationKind = 'cart' | 'stand';

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
    comment: "'cart' | 'stand'",
  })
  kind!: CartLocationKind;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
