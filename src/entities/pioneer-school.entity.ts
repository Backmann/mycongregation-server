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
} from 'typeorm';
import { Congregation } from './congregation.entity';

/**
 * A Pioneer Service School the congregation is hosting.
 *
 * The school lasts several days in a row, in days that are mostly NOT meeting
 * days, so it cannot borrow the duties machinery — that is keyed by "the
 * Monday of a week plus midweek/weekend". It borrows the ROLES instead: the
 * same audio/video, microphone and ventilation the congregation already knows.
 *
 * The venue is stored as a NAME AND ADDRESS, not as a link to a hall. Most of
 * these schools are held in someone else's Kingdom Hall, and the row that
 * describes that hall belongs to another part of the app which may be edited
 * or deleted later. The sheet handed to twenty brothers has to keep saying
 * where they actually went.
 */
@Entity('pioneer_schools')
@Index(['congregationId', 'startDate'])
export class PioneerSchool {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  /** Venue as it should read on the sheet — a snapshot, see the class note. */
  @Column({ type: 'varchar', length: 160, nullable: true })
  hallName!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  hallAddress!: string | null;

  /** 'HH:mm' for the whole school; a single day may override both. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  startTime!: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  endTime!: string | null;

  /** Two is the usual number, not a law — hence a column, not a constant. */
  @Column({ type: 'int', default: 2 })
  microphoneSlots!: number;

  /** Free text with the light markup the app already uses: **bold**, _italic_. */
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
