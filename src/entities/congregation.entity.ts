import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('congregations')
export class Congregation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({
    type: 'varchar',
    length: 2,
    comment: 'ISO 3166-1 alpha-2 country code',
  })
  country!: string;

  @Column({
    type: 'varchar',
    length: 5,
    comment: 'IETF BCP 47 language tag (ru, de, en-US)',
  })
  language!: string;

  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: 'IANA timezone (Europe/Berlin)',
  })
  timezone!: string | null;

  /**
   * The first month («YYYY-MM») of the pioneers' own hours log here; null —
   * the log is not on. Months before it are left alone entirely: a report
   * for them is handed in as it always was (Lionel, 29 October 2026 — so
   * that October's reports, collected in November, are not muddled with a
   * log that only began at their end).
   */
  @Column({ type: 'varchar', length: 7, nullable: true })
  hoursLogFrom!: string | null;

  @Column({
    type: 'boolean',
    default: false,
    comment: 'Opt-in for congregation-specific assignment automation rules',
  })
  assignmentAutomationEnabled!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;
}
