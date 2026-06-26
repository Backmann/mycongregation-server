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
  Unique,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { CartSlot } from './cart-slot.entity';

export type CartWeekStatus = 'draft' | 'collecting' | 'published';

/**
 * One public-witnessing week-grid for a congregation. Slots are generated from
 * the chosen window (startTime..endTime) and step. Lifecycle: draft (built,
 * hidden) -> collecting (publishers apply) -> published (Phase 3: names shown).
 * One week per congregation per Monday.
 */
@Entity('cart_weeks')
@Unique('uq_cart_week_congregation_week', ['congregationId', 'weekStartDate'])
export class CartWeek {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'date', comment: 'Monday of the ISO week' })
  weekStartDate!: string;

  @Column({
    type: 'varchar',
    length: 12,
    default: 'draft',
    comment: "'draft' | 'collecting' | 'published'",
  })
  status!: CartWeekStatus;

  @Column({ type: 'varchar', length: 5, comment: '"HH:MM" window start' })
  startTime!: string;

  @Column({ type: 'varchar', length: 5, comment: '"HH:MM" window end' })
  endTime!: string;

  @Column({ type: 'smallint', comment: '60 | 90 | 120' })
  stepMinutes!: number;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @OneToMany(() => CartSlot, (s) => s.week)
  slots!: CartSlot[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
