import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { UserRole } from '../common/enums/user-role.enum';

/**
 * One row per (user, browser/device) pair, created when a user opts in to
 * Web Push from the PWA. Deleted when:
 *   - The user explicitly unsubscribes
 *   - The push service returns HTTP 410 Gone / 404 Not Found for this
 *     subscription (browser permission revoked, profile wiped, etc.)
 *
 * No FK to users — keeps cleanup paths simple and consistent with push_tokens.
 */
@Entity('web_push_subscriptions')
@Index(['congregationId'])
@Index(['userId'])
export class WebPushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: UserRole;

  @Column({ type: 'varchar', length: 2048, unique: true })
  endpoint!: string;

  @Column({ type: 'varchar', length: 255 })
  p256dh!: string;

  @Column({ type: 'varchar', length: 255 })
  auth!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastFailedAt!: Date | null;
}
