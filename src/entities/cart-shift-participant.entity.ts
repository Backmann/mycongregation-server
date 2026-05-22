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
import { CartShift } from './cart-shift.entity';
import { Publisher } from './publisher.entity';

/** A publisher assigned to one cart shift. Unique per (shift, publisher). */
@Entity('cart_shift_participants')
@Unique('uq_cart_participant', ['cartShiftId', 'publisherId'])
@Index(['cartShiftId'])
export class CartShiftParticipant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  cartShiftId!: string;

  @ManyToOne(() => CartShift, (s) => s.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_shift_id' })
  shift!: CartShift;

  @Column({ type: 'uuid' })
  publisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
