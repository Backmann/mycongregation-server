import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * One row per signed-in device. Before this the refresh token was a bare JWT:
 * signing out could not kill it, changing a password could not kill it, and a
 * stolen token stayed usable for its full 30 days with nobody able to tell.
 *
 * The token itself is never stored — only a SHA-256 digest of it. The token is
 * 	high-entropy and machine-generated, so a fast digest is the right tool here;
 * bcrypt guards against guessing low-entropy human passwords, which is a
 * different problem.
 *
 * Every refresh rotates: the presented session is revoked and a fresh one
 * issued. That is what makes theft detectable — see reuse handling in
 * AuthService.refresh().
 */
@Entity('refresh_sessions')
export class RefreshSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** SHA-256 hex digest of the refresh token this session was issued with. */
  @Column({ type: 'text' })
  tokenHash: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  /** Set when the session is rotated away, signed out, or revoked wholesale. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
