import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * THE ANNUAL MEETING OF THE ELDERS WITH THE PIONEERS (Lionel, 30 October 2026).
 *
 * Once a year, in December or January, an elder the body chooses meets the
 * regular and special pioneers and the missionaries serving in the field, on
 * the outline S-211. Its own record and not a special event: an event is read
 * by a dozen parts of the app as something the whole congregation keeps
 * (the hall busy, the week's rules) and is announced to everyone. This one
 * changes no meeting, keeps no hall, and is said only to those it concerns —
 * the pioneers of that day and the elder who conducts it.
 *
 * Who is invited is not stored: it is whoever pioneers on its date, asked
 * when it is read. A pioneer appointed in December is invited to a January
 * meeting without anybody touching it.
 */
@Entity('pioneer_meetings')
@Index(['congregationId', 'date'])
export class PioneerMeeting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'date' })
  date!: string;

  /** HH:mm */
  @Column({ type: 'varchar', length: 5, nullable: true })
  timeStart!: string | null;

  /** HH:mm */
  @Column({ type: 'varchar', length: 5, nullable: true })
  timeEnd!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  place!: string | null;

  /** The elder who conducts it — a publisher card. */
  @Column({ type: 'uuid' })
  conductorPublisherId!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
