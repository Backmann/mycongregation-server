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
import { CartDay } from './cart-day.entity';
import { Publisher } from './publisher.entity';

/**
 * A place on the plan: who stands at the stand, from — to. Exactly one of
 * publisherId (our publisher) or externalName (a guest from another
 * congregation, who counts towards the two to four but whose gender is
 * unknown) is set. That one person stands in two places at once, or that a
 * place holds more than four at any half-hour, is refused by the service
 * under a lock — a span cannot be kept unique by an index.
 */
@Entity('cart_assignments')
@Index(['dayId'])
export class CartAssignment {
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

  /** The span he stands, on the half-hour. */
  @Column({ type: 'varchar', length: 5 })
  startTime!: string;

  @Column({ type: 'varchar', length: 5 })
  endTime!: string;

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

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
