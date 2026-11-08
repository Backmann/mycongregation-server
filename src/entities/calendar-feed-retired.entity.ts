import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * A calendar link that no longer works (8 November 2026).
 *
 * A calendar that gets «not found» keeps the last events it had — so a
 * changed or switched-off link would leave old assignments in somebody's
 * phone for good. For a link that WAS real, the feed instead answers with an
 * empty calendar and one notice; the phone drops the old events at its next
 * read. Only the hash is kept, with nothing about the person: the language of
 * the notice and the congregation for its timezone. Forgotten after half a
 * year, by when every calendar has read the notice many times.
 */
@Entity('calendar_feed_retired')
export class CalendarFeedRetired {
  /** SHA-256 of the old token, hex. */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'varchar', length: 5 })
  lang!: string;

  /** rotated, disconnected, sessions_ended. */
  @Column({ type: 'varchar', length: 24 })
  reason!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  retiredAt!: Date;
}
