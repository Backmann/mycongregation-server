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
 * Congregation-wide special events shown in the upcoming-events feed:
 * circuit assemblies, regional conventions, the Memorial, circuit overseer
 * and branch representative visits, etc. `type` is a free key (extensible
 * without a migration); `title` is the display name. `date` is the start;
 * `endDate` is set for multi-day events (e.g. conventions, week-long visits).
 */
@Entity('special_events')
export class SpecialEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  type!: string | null;

  @Column({ type: 'date' })
  @Index()
  date!: string;

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  time!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'text', nullable: true })
  mapUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  programUrl!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  // ---- Circuit overseer visit only: name snapshot for the banner ----
  @Column({ type: 'varchar', length: 100, nullable: true })
  coFirstName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  coLastName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  coWifeName!: string | null;

  /**
   * Undo plan for the circuit-overseer program template (set only on
   * `circuit_overseer_visit` events). Deleting the event replays this to
   * restore the meeting; null means no template is currently applied.
   */
  @Column({ type: 'jsonb', nullable: true })
  coRevertData!: unknown[] | null;

  @Column({ type: 'boolean', default: false })
  replacesMeeting!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
