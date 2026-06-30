import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * One free-text theme per calendar month for field-service meetings (e.g. a
 * monthly emphasis). Separate from a meeting's own per-entry topic. Keyed by
 * (congregation, year, month) so it groups under the month header on the
 * field-service journal page.
 */
@Entity('field_service_month_themes')
@Index(['congregationId', 'year', 'month'], { unique: true })
export class FieldServiceMonthTheme {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'int' })
  year!: number;

  @Column({ type: 'int', comment: '1-12' })
  month!: number;

  @Column({ type: 'text' })
  theme!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
