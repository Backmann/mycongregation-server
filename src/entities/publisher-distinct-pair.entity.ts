import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * «These two are different people» (1 November 2026): said once about two
 * cards the duplicate watcher thought alike, so it does not ask again. The
 * pair is kept in id order — one row per pair, whichever way it was said.
 */
@Entity('publisher_distinct_pairs')
export class PublisherDistinctPair {
  @Column({ type: 'uuid' })
  congregationId!: string;

  @PrimaryColumn({ type: 'uuid' })
  aId!: string;

  @PrimaryColumn({ type: 'uuid' })
  bId!: string;

  @Column({ type: 'uuid', nullable: true })
  byUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
