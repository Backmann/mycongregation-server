import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { Publisher } from './publisher.entity';
import { User } from './user.entity';

@Entity('service_reports')
@Unique('uq_service_reports_publisher_month', ['publisherId', 'reportMonth'])
export class ServiceReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Publisher being reported on ----
  @Column({ type: 'uuid' })
  @Index()
  publisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher;

  // ---- Report period ----
  @Column({
    type: 'date',
    comment: 'First day of reported month (YYYY-MM-01)',
  })
  @Index()
  reportMonth!: string;

  // ---- Form variant: regular publisher ----
  @Column({
    type: 'boolean',
    nullable: true,
    comment: 'Set for regular publishers (PioneerType.NONE)',
  })
  servedThisMonth!: boolean | null;

  // ---- Form variant: pioneer ----
  @Column({
    type: 'integer',
    nullable: true,
    comment: 'Set for pioneers (PioneerType !== NONE)',
  })
  hoursReported!: number | null;

  // ---- Common to both forms ----
  @Column({ type: 'integer', default: 0 })
  bibleStudies!: number;

  // TODO: encrypt at rest once data-protection.md is designed.
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // ---- Submission metadata ----
  @Column({ type: 'timestamptz' })
  submittedAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  submittedById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'submitted_by_id' })
  submittedBy!: User | null;

  @Column({ type: 'boolean', default: false })
  submittedOnBehalfOf!: boolean;

  // ---- Standard ----
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
