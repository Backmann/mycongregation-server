import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A failure in the app as people meet it (10 November 2026): a screen that
 * fell over, an error nobody caught. Until then a failure on someone's phone
 * reached us only if he told us.
 *
 * Technical facts only — never a name, a login, a congregation, what was
 * typed or shown. The same failure on the same day is one row with a count,
 * so one fault met by a hundred people does not fill the journal. Rows older
 * than thirty days are deleted (see ClientErrorsService).
 */
@Entity('client_errors')
@Index('UQ_client_errors_day_fingerprint', ['day', 'fingerprint'], {
  unique: true,
})
export class ClientError {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The UTC day it was met on. */
  @Column({ type: 'date' })
  day!: string;

  /** What makes two reports the same failure: where, what, from which line. */
  @Column({ type: 'varchar', length: 64 })
  fingerprint!: string;

  /** web, android, ios. */
  @Column({ type: 'varchar', length: 16 })
  platform!: string;

  /** The app's build, as the last report gave it. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  appCommit!: string | null;

  /** The screen as a pattern — «/schedule/[id]», never a real id. */
  @Column({ type: 'varchar', length: 200 })
  route!: string;

  /** The role of whoever met it, or null before signing in. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  role!: string | null;

  /** «screen» — a screen fell over; «uncaught» — an error nobody caught. */
  @Column({ type: 'varchar', length: 16 })
  source!: string;

  @Column({ type: 'varchar', length: 300 })
  message!: string;

  /** The first lines of where in the code, scrubbed. */
  @Column({ type: 'varchar', length: 1500, nullable: true })
  stack!: string | null;

  /**
   * Which event caught it, as the last report gave it: «error» (a script's
   * error), «rejection» (a promise nobody waited for), «handler» (the
   * phone's global handler), «screen»; null from older builds.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  event!: string | null;

  /** Whether the device thought it was online; null: not told. */
  @Column({ type: 'boolean', nullable: true })
  online!: boolean | null;

  /** The file and line the browser names for it, scrubbed; null: none. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  place!: string | null;

  /** Seconds from the app's start to the failure. */
  @Column({ type: 'integer', nullable: true })
  sinceStartS!: number | null;

  @Column({ type: 'integer', default: 1 })
  count!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  firstAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastAt!: Date;
}
