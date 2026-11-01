import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/**
 * One merge of two publisher cards (1 November 2026).
 *
 * The card that was merged is deleted for good — a hidden card lying in the
 * table would be read by every place that counts departed cards on purpose
 * (the monthly and annual figures read them), and would be counted twice.
 * What «Разъединить» needs to put everything back lives here instead: the
 * card as it was, every row that moved, every row left out, every field the
 * kept card took. It is personal data, so it is encrypted and kept only
 * thirty days; after that the merge is final and this row is removed.
 */
@Entity('publisher_merges')
@Index(['congregationId', 'keptId'])
@Index(['congregationId', 'mergedId'])
export class PublisherMerge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  /** The card that stayed. */
  @Column({ type: 'uuid' })
  keptId!: string;

  /** The card that was merged into it and deleted. */
  @Column({ type: 'uuid' })
  mergedId!: string;

  @Column({ type: 'uuid', nullable: true })
  byUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  /** After this the merge can no longer be undone and the row goes. */
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  undoneAt!: Date | null;

  /** What moved, said for people: table → number of rows. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  summary!: Record<string, number>;

  /** Everything «Разъединить» needs (MergePayload), encrypted. */
  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  payload!: string | null;
}
