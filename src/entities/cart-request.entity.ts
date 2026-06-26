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
import { CartSlot } from './cart-slot.entity';
import { Publisher } from './publisher.entity';

/**
 * A publisher's application ("заявка") to a slot during the collecting phase.
 * The mere existence of a row means an active wish; withdrawing deletes it.
 * withWhomNote is a free-text "I'd like to serve with ..." (may name someone
 * from another congregation), shown only to the responsible.
 */
@Entity('cart_requests')
@Unique('uq_cart_request_slot_publisher', ['slotId', 'publisherId'])
@Index(['slotId'])
export class CartRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  slotId!: string;

  @ManyToOne(() => CartSlot, (s) => s.requests, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slot_id' })
  slot!: CartSlot;

  @Column({ type: 'uuid' })
  publisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher;

  @Column({ type: 'text', nullable: true })
  withWhomNote!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
