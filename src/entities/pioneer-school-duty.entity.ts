import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PioneerSchoolDay } from './pioneer-school-day.entity';
import { PioneerSchoolHelper } from './pioneer-school-helper.entity';
import { DutyType } from '../common/enums/duty-type.enum';

/**
 * One role on one day, and who holds it.
 *
 * The role names are the congregation's existing DutyType values — audio and
 * video, microphone, ventilation — so a brother reads the same words here as
 * on the meeting sheet, in whichever of the three languages he reads.
 *
 * A row per role rather than columns on the day: the number of microphones
 * varies, custom rows get added, and one brother holding two roles in a day is
 * ordinary rather than exceptional. Columns would have made all three awkward.
 */
@Entity('pioneer_school_duties')
@Unique('uq_pioneer_school_duty', ['dayId', 'dutyType', 'slotIndex'])
@Index(['congregationId', 'helperId'])
export class PioneerSchoolDuty {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  dayId!: string;

  @ManyToOne(() => PioneerSchoolDay, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'day_id' })
  day!: PioneerSchoolDay;

  @Column({ type: 'varchar', length: 32 })
  dutyType!: DutyType;

  @Column({ type: 'int', default: 0 })
  slotIndex!: number;

  /** Label for a custom role («встреча гостей»); null for the known ones. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  customLabel!: string | null;

  @Column({ type: 'uuid', nullable: true })
  helperId!: string | null;

  @ManyToOne(() => PioneerSchoolHelper, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'helper_id' })
  helper!: PioneerSchoolHelper | null;
}
