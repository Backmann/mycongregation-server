import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One time a local-needs topic was given (28 October 2026).
 *
 * The topic itself only knows its LAST week, so a subject that came back a
 * year later forgot that it had been given before — and «когда мы это уже
 * разбирали?» is the first question the body of elders asks of a topic. Each
 * use is kept here for two years (Lionel: «историю обязательно хранить на
 * протяжении 2 лет»), then deleted by the nightly job.
 *
 * The speaker is read from the part when it still exists (he may have been
 * put on it after the topic was placed); the stored one is what is left when
 * the part is gone.
 */
@Entity('local_needs_uses')
@Index(['topicId', 'weekStartDate'], { unique: true })
export class LocalNeedsUse {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  congregationId!: string;

  @Column({ type: 'uuid' })
  topicId!: string;

  /** Monday of the week the topic was given. */
  @Column({ type: 'date' })
  weekStartDate!: string;

  @Column({ type: 'uuid', nullable: true })
  assignmentId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  speakerPublisherId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
