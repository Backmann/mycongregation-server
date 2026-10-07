import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Up to when a person has read what the app told them.
 *
 * One moment per person, not a flag per message: «Мои уведомления» is a list
 * read from the top, and opening it means having seen what is in it. Kept on
 * the server so that the dot on the bell goes out on the phone when the list
 * was read on the computer.
 *
 * A table of its own rather than a column on the account: a new column on
 * `users` is selected by every query that reads a user, in the seconds
 * between a deploy and its migration — a new table is asked for by one
 * endpoint only.
 */
@Entity('inbox_seen')
export class InboxSeen {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'timestamptz' })
  seenAt!: Date;
}
