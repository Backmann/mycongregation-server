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
import { Assignment } from './assignment.entity';
import { Publisher } from './publisher.entity';

/**
 * Two people of one part agreeing when to prepare it (10 November 2026).
 *
 * One row a part: the open proposal, or what was answered to it. It holds no
 * text anybody typed — only which of the offered moments was chosen (a
 * meeting, a field service meeting, or «we'll arrange it ourselves») — and it
 * lives only until the day after the meeting (PairPrepService.prune). A change
 * of either person on the part makes it void: it is deleted when read.
 *
 * Not in the congregation's journal and not shown to whoever arranges the
 * programme: it is a matter between the two of them.
 */
@Entity('pair_agreements')
@Index('UQ_pair_agreements_assignment', ['assignmentId'], { unique: true })
export class PairAgreement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  assignmentId!: string;

  @ManyToOne(() => Assignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignment_id' })
  assignment!: Assignment;

  /** The pair as it was when the row was made; a different pair voids it. */
  @Column({ type: 'uuid' })
  holderPublisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'holder_publisher_id' })
  holder!: Publisher;

  @Column({ type: 'uuid' })
  assistantPublisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assistant_publisher_id' })
  assistantPublisher!: Publisher;

  /** Who made the proposal that is open or was answered. */
  @Column({ type: 'uuid' })
  proposedByPublisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'proposed_by_publisher_id' })
  proposedBy!: Publisher;

  /** after | before | service | self — see pair-prep-options.ts. */
  @Column({ type: 'varchar', length: 16 })
  optionKind!: string;

  /** The day of the chosen moment; null for «self». */
  @Column({ type: 'date', nullable: true })
  optionDate!: string | null;

  /** Its hour (HH:mm) as it was offered; null for «self». */
  @Column({ type: 'varchar', length: 5, nullable: true })
  optionTime!: string | null;

  /** midweek | weekend for a meeting; null otherwise. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  optionMeeting!: string | null;

  /** proposed | agreed | declined */
  @Column({ type: 'varchar', length: 10 })
  status!: string;

  @Column({ type: 'timestamptz' })
  proposedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  answeredAt!: Date | null;

  /** The meeting day of the part — the row is deleted the day after it. */
  @Column({ type: 'date' })
  meetingDate!: string;

  /** The day a new proposal was last started (once a day per pair). */
  @Column({ type: 'date' })
  lastStartedOn!: string;

  /** Messages of this pair today: a ceiling against a ping-pong. */
  @Column({ type: 'date' })
  messagesOn!: string;

  @Column({ type: 'integer', default: 0 })
  messagesCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
