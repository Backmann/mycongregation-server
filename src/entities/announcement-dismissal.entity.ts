import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * «Not needed»: a writer let a suggested announcement go (announcements
 * R-09, 26 November 2026).
 *
 * Suggestions are computed and never stored (suggestion-rules.ts); this is
 * the one thing remembered about one that was refused, so it is not offered
 * again to him or to the other writers. It names no person: only which
 * suggestion and the week it was meant for, so it leaves with that week's
 * announcements (retention «announcements»).
 */
@Entity('announcement_dismissals')
@Index(['congregationId', 'sourceKey'], { unique: true })
export class AnnouncementDismissal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'varchar', length: 120 })
  sourceKey!: string;

  /** Monday of the week the suggestion was meant for. */
  @Column({ type: 'date' })
  weekStartDate!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
