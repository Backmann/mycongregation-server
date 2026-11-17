import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** One elder's answer to a question of the form's second page. */
export interface FolderAnswer {
  answer: 'yes' | 'no' | 'na';
  byUserId: string;
  at: string;
}

/**
 * The folder for the circuit overseer (form S-61, 12/25) — one per visit
 * (17 November 2026).
 *
 * What the app keeps is how the folder stands, never its content: which
 * file was saved and when, who marked an item «separate file», «on paper» or
 * «does not apply», the S-62 milestone, and the answers to the fifteen
 * questions of page 2. The answers are erased the day after the visit ends
 * (decision of 17 November 2026); `handedOverAt` stays, because the next
 * folder's hints count «since the previous visit» from it.
 */
@Entity('co_visit_folders')
@Index('UQ_co_visit_folders_event', ['specialEventId'], { unique: true })
export class CoVisitFolder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  specialEventId!: string;

  /** The secretary sent the S-62 (at least a month before the visit). */
  @Column({ type: 'timestamptz', nullable: true })
  s62SentAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  s62SentByUserId!: string | null;

  /** The coordinator made sure it went. */
  @Column({ type: 'timestamptz', nullable: true })
  s62CheckedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  s62CheckedByUserId!: string | null;

  /** Page 2, by question number. Null once erased. */
  @Column({ type: 'jsonb', nullable: true })
  answers!: Record<string, FolderAnswer> | null;

  @Column({ type: 'timestamptz', nullable: true })
  answersErasedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  handedOverAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  handedOverByUserId!: string | null;

  /** Who removed the folder's files from his computer, by user id. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  filesDeleted!: Record<string, string>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
