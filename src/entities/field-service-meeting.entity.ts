import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { ServiceGroup } from './service-group.entity';
import { Publisher } from './publisher.entity';

/**
 * A single field-ministry meeting for one congregation and week. Mirrors the
 * tenant + weekStartDate keying used by Assignment/Duty, so entries surface
 * under the same week navigator.
 *
 * Deliberately flexible: there is no fixed recurring schedule. The service
 * overseer adds as many entries per week as needed, each with its own day,
 * time, location, optional conductor, topic and source link. No unique
 * constraint — multiple meetings may share a day/time.
 */
@Entity('field_service_meetings')
@Index(['congregationId', 'weekStartDate'])
@Index(['congregationId', 'conductorPublisherId'])
export class FieldServiceMeeting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- When ----
  @Column({
    type: 'date',
    comment: 'Monday of the ISO week (frontend normalizes to Monday)',
  })
  weekStartDate!: string;

  @Column({
    type: 'smallint',
    comment: 'ISO day of week: 1=Mon .. 7=Sun',
  })
  dayOfWeek!: number;

  @Column({
    type: 'varchar',
    length: 5,
    comment: 'Local start time, "HH:MM" 24h',
  })
  startTime!: string;

  // ---- Where / who / what ----
  @Column({ type: 'varchar', length: 255 })
  address!: string;

  @Column({ type: 'uuid', nullable: true })
  conductorPublisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'conductor_publisher_id' })
  conductor!: Publisher | null;

  @Column({ type: 'text', nullable: true })
  topic!: string | null;

  @Column({
    type: 'text',
    nullable: true,
    comment: 'Optional source link (e.g. jw.org)',
  })
  sourceUrl!: string | null;

  @Column({
    type: 'boolean',
    default: false,
    comment: 'Combined field-service meeting for the whole congregation',
  })
  isGeneral!: boolean;

  /**
   * Whose meeting this is. Null means it belongs to no particular group —
   * either a general one, or one recorded before groups were known here.
   *
   * Meetings in this congregation are sometimes per group and sometimes for
   * everyone, and until now a meeting could not say which: a group could not
   * be shown its own outings, and nothing could count how often a group had
   * been visited. `onDelete: SET NULL` because disbanding a group must not
   * take its history of meetings with it.
   */
  @Column({ type: 'uuid', nullable: true })
  serviceGroupId!: string | null;

  @ManyToOne(() => ServiceGroup, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'service_group_id' })
  serviceGroup?: ServiceGroup | null;

  /**
   * The service overseer visits this group's meeting.
   *
   * A visit is a MARK ON THE MEETING, not an event of its own: he conducts the
   * meeting and preaches with the group on one occasion, and a separate record
   * would mean two dates about the same thing — which is how they drift apart.
   */
  @Column({ type: 'boolean', default: false })
  serviceOverseerVisit!: boolean;

  /** Who actually went. Filled from the appointed brother, but STORED: in two
   * years someone else holds the role and the history must still be true. */
  @Column({ type: 'uuid', nullable: true })
  serviceOverseerPublisherId!: string | null;

  /** His assistant, when one came. Part of the SAME record — a second row
   * would count two visits where there was one. */
  @Column({ type: 'uuid', nullable: true })
  serviceOverseerAssistantId!: string | null;

  // ---- Timestamps ----
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
