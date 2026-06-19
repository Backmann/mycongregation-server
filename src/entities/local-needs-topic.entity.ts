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
import { Publisher } from './publisher.entity';

/**
 * A planned "Local Needs" topic — a backlog item the body of elders maintains
 * for the midweek "Living as Christians" slot. Topics start as planned
 * (usedWeek = null) and are marked done when slotted into a week. Reading is
 * open to any authenticated member (so the schedule editor can offer the
 * backlog); writing is limited to scheduling managers — see the service.
 */
@Entity('local_needs_topics')
@Index(['congregationId', 'usedWeek'])
export class LocalNeedsTopic {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Content (congregation material, not personal — not encrypted) ----
  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // ---- Optional intended speaker ----
  @Column({ type: 'uuid', nullable: true })
  @Index()
  speakerPublisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'speaker_publisher_id' })
  speaker!: Publisher | null;

  // ---- Planning ----
  /** Monday (YYYY-MM-DD) of the week this topic was used; null = still planned. */
  @Column({ type: 'date', nullable: true })
  usedWeek!: string | null;

  /** Manual ordering of the backlog (lower first). */
  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
