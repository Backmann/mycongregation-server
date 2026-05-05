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
import { Publisher } from './publisher.entity';
import { PublicTalk } from './public-talk.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';

@Entity('assignments')
@Index(['congregationId', 'weekStartDate', 'eventType'])
@Index(['congregationId', 'publisherId'])
@Index(['publicTalkId'])
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ---- Tenant key ----
  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  // ---- Time / event ----
  @Column({
    type: 'date',
    comment: 'Monday of the ISO week (frontend normalizes to Monday)',
  })
  weekStartDate!: string;

  @Column({ type: 'enum', enum: EventType })
  eventType!: EventType;

  // ---- Part identity ----
  @Column({
    type: 'varchar',
    length: 64,
    comment: 'Programmatic key, e.g. bible_reading, treasures_talk, apply_yourself_1',
  })
  partKey!: string;

  @Column({
    type: 'integer',
    default: 0,
    comment: 'Sort order within the event (1, 2, 3...)',
  })
  partOrder!: number;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'Override label, e.g. "1 Тимофею 2:1-15" or "Why we should pray"',
  })
  partTitle!: string | null;

  @Column({ type: 'integer', nullable: true })
  partDurationMin!: number | null;

  // ---- Assignment ----
  @Column({ type: 'uuid', nullable: true })
  publisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'publisher_id' })
  publisher!: Publisher | null;

  @Column({ type: 'uuid', nullable: true })
  assistantPublisherId!: string | null;

  @ManyToOne(() => Publisher, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assistant_publisher_id' })
  assistantPublisher!: Publisher | null;

  // ---- Public talk reference (used when partKey = 'public_talk_speaker') ----
  @Column({
    type: 'uuid',
    nullable: true,
    comment: 'Reference to the global S-34 public talk catalog',
  })
  publicTalkId!: string | null;

  @ManyToOne(() => PublicTalk, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'public_talk_id' })
  publicTalk!: PublicTalk | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'For invited speakers from another congregation; null if local publisher',
  })
  speakerName!: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'Speaker home congregation name (for invited speakers)',
  })
  speakerCongregation!: string | null;

  // ---- State ----
  @Column({
    type: 'enum',
    enum: AssignmentStatus,
    default: AssignmentStatus.DRAFT,
  })
  status!: AssignmentStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // ---- Standard ----
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
