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
 * Once a year, in December or January, the elders the body chooses meet the
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

  /*
   * Who conducts it (Lionel, 9 November 2026): two brothers as a rule, one
   * at times — an elder, rarely a ministerial servant, or someone not in
   * the app whose name is written by hand (an elder from elsewhere). Two
   * places, each a card OR a written name; the first is never empty.
   * Read them through conductorsOf (pioneer-meeting-rules.ts).
   */

  /** The first conductor's card — or null when his name is written. */
  @Column({ type: 'uuid', nullable: true })
  conductorPublisherId!: string | null;

  /** The first conductor's name written by hand (nobody's card). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  conductorName!: string | null;

  /** The second conductor's card, if there is a second one. */
  @Column({ type: 'uuid', nullable: true })
  secondConductorPublisherId!: string | null;

  /** …or his name written by hand. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  secondConductorName!: string | null;

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
