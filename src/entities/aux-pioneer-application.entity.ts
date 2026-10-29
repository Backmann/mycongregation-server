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
import { Publisher } from './publisher.entity';

/**
 * An application to serve as an auxiliary pioneer — the S-205b form, online
 * (Lionel, 29 October 2026).
 *
 * The publisher fills it and confirms it; the three brothers of the service
 * committee each approve it — or another elder in the place of one who is
 * the applicant himself, or away. Once approved it makes the periods and is
 * kept for good, as the paper is kept in the congregation's files. A pending
 * one that is taken back — by the applicant, or quietly by the committee —
 * is deleted outright: nothing about it is kept but a line in the journal.
 *
 * The answers to the form's questions for the committee are NOT kept here or
 * anywhere: the approval of the brothers is the answer.
 */
@Entity('aux_pioneer_applications')
@Index(['congregationId', 'status'])
export class AuxPioneerApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  @Index()
  publisherId!: string;

  @ManyToOne(() => Publisher, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher;

  /**
   * The months asked for («YYYY-MM»), in order — not necessarily one after
   * another: «March and May» is one application. For «until cancelled», the
   * first month alone.
   */
  @Column({ type: 'text', array: true })
  months!: string[];

  @Column({ type: 'boolean', default: false })
  untilCancelled!: boolean;

  /** The months among them with 15 hours instead of 30. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  reducedMonths!: string[];

  /** 'pending' until all the places have approved; then 'approved', for good. */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: 'pending' | 'approved';

  /** 'app' — filled by the publisher; 'paper' — the signed form, entered by the secretary. */
  @Column({ type: 'varchar', length: 8, default: 'app' })
  source!: 'app' | 'paper';

  /** Who sent it: the publisher, or the secretary entering a paper. */
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  /** A paper: the date it was signed. */
  @Column({ type: 'date', nullable: true })
  paperDate!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  /** The periods it made, once approved. */
  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  periodIds!: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/** The three places of the service committee. */
export const COMMITTEE_SEATS = [
  'body_coordinator',
  'secretary',
  'service_overseer',
] as const;
export type CommitteeSeat = (typeof COMMITTEE_SEATS)[number];

/**
 * One place of the committee on one application. Its holder is whoever holds
 * the responsibility now; once the place is OPEN — the holder is the
 * applicant, passed it on, or is away — any elder may answer in it, but no
 * brother answers in two places.
 */
@Entity('aux_pioneer_application_seats')
@Index(['applicationId', 'seat'], { unique: true })
export class AuxPioneerApplicationSeat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  @Index()
  applicationId!: string;

  @ManyToOne(() => AuxPioneerApplication, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application!: AuxPioneerApplication;

  @Column({ type: 'varchar', length: 32 })
  seat!: CommitteeSeat;

  /** Open to any elder — and why: 'applicant' | 'passed' | 'absent' | 'opened'. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  openReason!: 'applicant' | 'passed' | 'absent' | 'opened' | null;

  @Column({ type: 'timestamptz', nullable: true })
  openedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  openedBy!: string | null;

  /** Who approved in this place, and when. */
  @Column({ type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt!: Date | null;

  /** The approver's name as it was — a paper's signers, or an elder since gone. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  approverName!: string | null;

  /** The quiet reminder after three days — once. */
  @Column({ type: 'timestamptz', nullable: true })
  remindedAt!: Date | null;
}
