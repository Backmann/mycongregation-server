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
 * The result of distribution: who stands in a slot. Exactly one of publisherId
 * (our publisher) or externalName (an outside person who counts toward the 2-4
 * crew but whose gender is unknown) is set. The UNIQUE on (slot_id,
 * publisher_id) keeps a publisher at most once per slot; PostgreSQL treats
 * NULLs as distinct, so multiple external entries per slot remain possible.
 */
@Entity('cart_assignments')
@Unique('uq_cart_assignment_slot_publisher', ['slotId', 'publisherId'])
@Index(['slotId'])
export class CartAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  slotId!: string;

  @ManyToOne(() => CartSlot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slot_id' })
  slot!: CartSlot;

  @Column({ type: 'uuid', nullable: true })
  publisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher | null;

  @Column({ type: 'text', nullable: true })
  externalName!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
