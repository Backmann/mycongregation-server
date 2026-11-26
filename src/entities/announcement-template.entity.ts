import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One congregation's setting for one suggested announcement — the «Templates»
 * screen (announcements R-05, R-09 step 4, 26 November 2026). No row: the
 * app's own (on, the app's words, the app's weeks).
 *
 * The words are the congregation's general wording with placeholders, not a
 * matter about anyone, so they are kept as they are written.
 */
@Entity('announcement_templates')
@Index(['congregationId', 'key'], { unique: true })
export class AnnouncementTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  /** «memorial.ahead», «accounts_month»… — TEMPLATE_KEYS. */
  @Column({ type: 'varchar', length: 40 })
  key!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** Null: the app's own words. */
  @Column({ type: 'text', nullable: true })
  words!: string | null;

  /** Null: the app's own number of weeks. */
  @Column({ type: 'smallint', nullable: true })
  weeksAhead!: number | null;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
