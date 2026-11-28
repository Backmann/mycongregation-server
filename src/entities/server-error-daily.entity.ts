import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The server's 5xx, one row per UTC day, route pattern and error class
 * (28 November 2026) — kept across restarts and deploys for /health/errors.
 * A pattern and a class name only: no message, no parameter, no person.
 * Platform-level, so its days are UTC, not a congregation's. Written by
 * ServerErrors with raw SQL; deleted after thirty days.
 */
@Entity('server_errors_daily')
export class ServerErrorDaily {
  @PrimaryColumn({
    type: 'date',
    primaryKeyConstraintName: 'PK_server_errors_daily',
  })
  day!: string;

  /** «GET /api/songs» — the route's pattern. */
  @PrimaryColumn({
    type: 'varchar',
    length: 200,
    primaryKeyConstraintName: 'PK_server_errors_daily',
  })
  route!: string;

  /** The error's class. */
  @PrimaryColumn({
    type: 'varchar',
    length: 80,
    primaryKeyConstraintName: 'PK_server_errors_daily',
  })
  kind!: string;

  @Column({ type: 'int', default: 1 })
  count!: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastAt!: Date;
}
