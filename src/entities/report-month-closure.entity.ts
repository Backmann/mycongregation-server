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
import { User } from './user.entity';

/**
 * A confirmed/closed reporting month. The presence of a row means the month
 * is closed: report edits are frozen for everyone except admins and the
 * secretary. Re-opening deletes the row.
 */
@Entity('report_month_closures')
@Unique('uq_report_month_closures_cong_month', [
  'congregationId',
  'reportMonth',
])
export class ReportMonthClosure {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Closed period ----
  @Column({
    type: 'date',
    comment: 'First day of the closed month (YYYY-MM-01)',
  })
  @Index()
  reportMonth!: string;

  // ---- Who closed it ----
  @Column({ type: 'uuid', nullable: true })
  closedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'closed_by_id' })
  closedBy!: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  closedAt!: Date;
}
