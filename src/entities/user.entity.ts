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
  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash!: string;
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
  @Column({
    type: 'varchar',
    length: 2,
    default: 'ru',
    comment: 'ISO 639-1 UI language code (ru, en, de)',
  })
  uiLanguage!: string;
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
