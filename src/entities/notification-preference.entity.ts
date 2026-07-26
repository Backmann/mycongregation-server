import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * What a person has chosen NOT to hear about.
 *
 * Only the switched-off categories are stored. Absence means "on", which makes
 * the sensible default the cheap one: a brother who has never opened the
 * settings still learns that he was given a talk. Making people opt IN to
 * their own assignments would be the quickest way to have somebody miss one.
 *
 * The categories are deliberately few and about the person's life in the
 * congregation, not about our modules: assignments, ministry, cleaning,
 * reports, and the administrative notices only overseers and the secretary
 * receive.
 */
@Entity('notification_preferences')
@Index('uq_notification_preferences_user_category', ['userId', 'category'], {
  unique: true,
})
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  category!: string;

  /** False is the only value worth storing; see the class comment. */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
