import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PioneerSchool } from './pioneer-school.entity';

/**
 * One day of the school.
 *
 * Days are derived from the school's dates, but they are rows rather than a
 * computed range because a single day drifts: one starts an hour later, one is
 * a Saturday that finishes early. A range cannot hold an exception, and the
 * exception is the thing people ask about.
 *
 * A null time means "as the school says" — so correcting the school's hours
 * corrects every day that never disagreed, which is what a person expects.
 */
@Entity('pioneer_school_days')
@Unique('uq_pioneer_school_day', ['schoolId', 'date'])
@Index(['congregationId', 'date'])
export class PioneerSchoolDay {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  schoolId!: string;

  @ManyToOne(() => PioneerSchool, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'school_id' })
  school!: PioneerSchool;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  startTime!: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  endTime!: string | null;
}
