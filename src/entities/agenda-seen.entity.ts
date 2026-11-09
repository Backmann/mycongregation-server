import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * What a person last saw of one of their own coming items on Home
 * (9 November 2026): the day, the hour, what it is, who with and where — the
 * things whose change earns «изменено». One row per person and agenda item
 * (agenda.types.ts AgendaItem.id); rows of past days are dropped when Home
 * is seen again. Only the person's own items, never anybody else's.
 */
@Entity('agenda_seen')
@Index('IDX_agenda_seen_congregation', ['congregationId'])
export class AgendaSeen {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ type: 'varchar', length: 160 })
  itemId!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  /** YYYY-MM-DD. */
  @Column({ type: 'date' })
  date!: string;

  /** HH:mm, or null for a whole day. */
  @Column({ type: 'varchar', length: 5, nullable: true })
  start!: string | null;

  @Column({ type: 'text' })
  title!: string;

  /** The others in it, «First Last», sorted. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  with!: string[];

  @Column({ type: 'text', nullable: true })
  place!: string | null;

  /**
   * The language the title was written in. After the person switches the
   * app's language every title reads differently without anything having
   * changed — so titles are compared only within one language. Null on rows
   * from before 9 November 2026: compared as unknown, never as changed.
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  lang!: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  seenAt!: Date;
}
