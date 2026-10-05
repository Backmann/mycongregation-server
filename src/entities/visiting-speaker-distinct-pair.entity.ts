import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { VisitingSpeaker } from './visiting-speaker.entity';

/**
 * «Это разные братья» — two cards of visiting speakers that look like one man
 * and are not (5 October 2026).
 *
 * The directory hints at likely doubles: the same name in another order or in
 * another alphabet. Namesakes are ordinary, so the hint needs a way to be
 * told «no» once and stay quiet — for everyone who keeps the directory, not
 * only on the phone where the answer was given. Hence a row on the server.
 *
 * The pair is stored in one order (`speakerAId` < `speakerBId`), so the same
 * two cards cannot be recorded twice.
 */
@Entity('visiting_speaker_distinct_pairs')
@Index(['congregationId', 'speakerAId', 'speakerBId'], { unique: true })
export class VisitingSpeakerDistinctPair {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'uuid' })
  speakerAId!: string;

  @ManyToOne(() => VisitingSpeaker, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'speaker_a_id' })
  speakerA!: VisitingSpeaker;

  @Column({ type: 'uuid' })
  speakerBId!: string;

  @ManyToOne(() => VisitingSpeaker, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'speaker_b_id' })
  speakerB!: VisitingSpeaker;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
