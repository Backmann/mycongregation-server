import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Congregation } from './congregation.entity';

export type CartWeekStatus = 'draft' | 'collecting' | 'published';

/**
 * One week at the stand for a congregation: its days (a place, a date, the
 * hours) and the state of the plan — draft (being sketched), collecting
 * (people sign up), published (the plan is everyone's). One week per
 * congregation per Monday.
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

  /**
   * When the week was published. A wish made before it and not granted is no
   * longer shown to the person — he sees he is not on the list, and nobody
   * tells him so (Lionel, 2 November 2026); a wish made after it is a request
   * for a free place and stays one.
   */
  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  /** The last day to sign up; reminders go out by it. */
  @Column({ type: 'date', nullable: true })
  signupUntil!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
