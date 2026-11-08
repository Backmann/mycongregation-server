import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { User } from './user.entity';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * A person's calendar subscription (7 November 2026): the secret link a
 * phone's calendar reads the agenda through.
 *
 * The link is found by the HASH of its token, never by the token itself, and
 * the token is kept only encrypted — so that «connect another device» can show
 * the same link again, while a copy of the database alone opens nobody's
 * calendar.
 */
@Entity('calendar_feeds')
@Index(['tokenHash'], { unique: true })
export class CalendarFeed {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  /** One subscription per login. */
  @Column({ type: 'uuid', unique: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** SHA-256 of the token, hex. */
  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'text', transformer: encryptedTransformer })
  token!: string;

  @Column({ type: 'boolean', default: true })
  includeMine!: boolean;

  @Column({ type: 'boolean', default: true })
  includeEvents!: boolean;

  @Column({ type: 'boolean', default: true })
  includeNames!: boolean;

  /** Last time a calendar read it — «последний раз забрал данные». */
  @Column({ type: 'timestamptz', nullable: true })
  lastFetchedAt!: Date | null;

  /** Which calendar, as far as its request says: google, apple, outlook, other. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  lastClient!: string | null;

  /**
   * Set when the link was switched off for the person (signing out
   * everywhere, a new password): the screen can say why the calendar
   * stopped, and the person connects again with a fresh link.
   */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  revokedReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
