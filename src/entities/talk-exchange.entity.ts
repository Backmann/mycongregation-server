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
import { VisitingSpeaker } from './visiting-speaker.entity';
import { ExternalCongregation } from './external-congregation.entity';
import { Publisher } from './publisher.entity';
import { PublicTalk } from './public-talk.entity';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../common/enums/talk-exchange.enum';

/**
 * One row of the public-talk coordinator's unified log. A single entity covers
 * both directions:
 *   - incoming: a visiting speaker comes to us (visitingSpeaker + talk). When
 *     enough data is present, the weekend public-talk slot for that week is
 *     auto-filled (asking before replacing an occupied slot, app-side).
 *   - outgoing: one of our publishers travels to a host congregation. A linked
 *     absence is created for that brother on the meeting date.
 * Scoped per tenant via congregationId; managed by admins and the
 * public_talk_coordinator.
 */
@Entity('talk_exchange')
@Index(['congregationId', 'date'])
export class TalkExchange {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Common ----
  @Column({ type: 'varchar', length: 16 })
  direction!: TalkExchangeDirection;

  /** Meeting date (the weekend the talk happens / the brother is away). */
  @Column({ type: 'date' })
  date!: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: TalkExchangeStatus.CONFIRMED,
  })
  status!: TalkExchangeStatus;

  @Column({ type: 'uuid', nullable: true })
  @Index()
  publicTalkId!: string | null;

  @ManyToOne(() => PublicTalk, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'public_talk_id' })
  publicTalk!: PublicTalk | null;

  // ---- Incoming side ----
  @Column({ type: 'uuid', nullable: true })
  @Index()
  visitingSpeakerId!: string | null;

  @ManyToOne(() => VisitingSpeaker, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'visiting_speaker_id' })
  visitingSpeaker!: VisitingSpeaker | null;

  /** Who hosts/receives the visiting speaker. */
  @Column({ type: 'uuid', nullable: true })
  hospitalityPublisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'hospitality_publisher_id' })
  hospitalityPublisher!: Publisher | null;

  // ---- Outgoing side ----
  @Column({ type: 'uuid', nullable: true })
  @Index()
  publisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher | null;

  @Column({ type: 'uuid', nullable: true })
  hostCongregationId!: string | null;

  @ManyToOne(() => ExternalCongregation, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'host_congregation_id' })
  hostCongregation!: ExternalCongregation | null;

  // ---- Links to auto-managed rows ----
  /** The absence created for an outgoing brother (so we can update/remove it). */
  @Column({ type: 'uuid', nullable: true })
  linkedAbsenceId!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
