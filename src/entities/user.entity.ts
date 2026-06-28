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
import { UserRole } from '../common/enums/user-role.enum';
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;
  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;
  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;
  @Column({ type: 'varchar', length: 255, select: false, nullable: true })
  passwordHash!: string | null;
  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.PUBLISHER,
  })
  role!: UserRole;
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
  /**
   * Whether this user may view publishers' private data (contacts, notes,
   * personal dates, removal details). Admins and elders always can; for any
   * other role this flag, set by an admin, grants the same visibility.
   */
  @Column({
    type: 'boolean',
    name: 'can_view_private_data',
    default: false,
  })
  canViewPrivateData!: boolean;

  /**
   * Platform owner / maintainer account. Set only via the database — never
   * exposed in any API or UI. Protected from role change, deactivation, email
   * change and password reset performed by other admins.
   */
  @Column({ type: 'boolean', name: 'is_owner', default: false })
  isOwner!: boolean;

  /**
   * When true, this user's presence (online / last active) is hidden from
   * other users in the admin list. Activity is still recorded; it is simply
   * masked for everyone except the user themselves.
   */
  @Column({ type: 'boolean', name: 'hide_presence', default: false })
  hidePresence!: boolean;
  @Column({
    type: 'varchar',
    length: 2,
    default: 'ru',
    comment: 'ISO 639-1 UI language code (ru, en, de)',
  })
  uiLanguage!: string;
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  /**
   * Last time the user made an authenticated request (throttled write).
   * Drives presence ("online") and "last active" on the admin user list.
   * Distinct from lastLoginAt, which only records sign-in events.
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  /** sha256 of the active password-reset token (never the token itself). */
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  resetTokenHash!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resetTokenExpiresAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
