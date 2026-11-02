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
import { Publisher } from './publisher.entity';

/**
 * A publisher's wish («заявка») for a span of a day at the stand. Several a
 * day are allowed — the morning and again after lunch.
 * The mere existence of a row means an active wish; withdrawing deletes it.
 * withWhomNote is a free-text "I'd like to serve with ..." (may name someone
 * from another congregation), shown only to the responsible.
 */
@Entity('cart_requests')
@Index(['dayId'])
export class CartRequest {
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

  /** The span he can stand, on the half-hour: «10:00»–«12:00». */
  @Column({ type: 'varchar', length: 5 })
  startTime!: string;

  @Column({ type: 'varchar', length: 5 })
  endTime!: string;

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
