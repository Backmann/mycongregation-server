import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A field-service meeting a person deleted (24 October 2026).
 *
 * Preparing a month again brought back the days the overseer had taken out
 * — the Saturday the hall was busy with the pioneer school came back as a
 * fresh draft (sync audit M2). The meeting row is gone with the delete, so
 * what it was is kept here: its day, time, place and group. Preparing the
 * month matches a template slot against these as it does against the
 * meetings that stand, and leaves the day alone with the words «убрано
 * вручную». A meeting put back by hand stands there again and wins.
 */
@Entity('field_service_removed_days')
@Index('IDX_field_service_removed_days_day', ['congregationId', 'date'])
export class FieldServiceRemovedDay {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 5 })
  startTime!: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  address!: string;

  @Column({ type: 'uuid', nullable: true })
  serviceGroupId!: string | null;

  @Column({ type: 'boolean', default: false })
  isGeneral!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  removedAt!: Date;
}
