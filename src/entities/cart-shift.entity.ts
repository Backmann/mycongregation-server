import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { CartShiftParticipant } from './cart-shift-participant.entity';

/**
 * A public-witnessing cart shift: a date, a time window and a location. Each
 * shift is staffed by 2-4 publishers (CartShiftParticipant). Shifts are
 * date-based (not week-based) and fully flexible — any day, any window.
 */
@Entity('cart_shifts')
@Index(['congregationId', 'date'])
export class CartShift {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 5, comment: '"HH:MM" 24h local time' })
  startTime!: string;

  @Column({ type: 'varchar', length: 5, comment: '"HH:MM" 24h local time' })
  endTime!: string;

  @Column({ type: 'varchar', length: 255 })
  location!: string;

  @OneToMany(() => CartShiftParticipant, (p) => p.shift)
  participants!: CartShiftParticipant[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
