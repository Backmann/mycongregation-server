import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DutyType } from '../common/enums/duty-type.enum';

/**
 * A congregation's place at its midweek or weekend meeting — the template a
 * new duty sheet is cut from (27 October 2026; see duties/duty-places.ts).
 *
 * No rows for a congregation and kind means «the code's list», exactly as
 * before this table existed.
 */
@Entity('duty_places')
@Index(['congregationId', 'meetingKind'])
export class DutyPlace {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'varchar', length: 16, comment: 'midweek | weekend' })
  meetingKind!: 'midweek' | 'weekend';

  @Column({ type: 'varchar', length: 32 })
  dutyType!: DutyType;

  @Column({ type: 'varchar', length: 60, nullable: true })
  customLabel!: string | null;

  @Column({ type: 'smallint', default: 1 })
  count!: number;

  @Column({ type: 'integer', default: 0 })
  sortOrder!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  capability!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
