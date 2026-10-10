import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * What the automatic preparation has done for one month of one
 * congregation — see FieldServiceAutomationService. Each step is a
 * timestamp, set once: the nightly pass asks «is it null» before acting.
 */
@Entity('field_service_month_runs')
export class FieldServiceMonthRun {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  @PrimaryColumn({ type: 'smallint' })
  year!: number;

  @PrimaryColumn({ type: 'smallint' })
  month!: number;

  @Column({ type: 'timestamptz', nullable: true })
  preparedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  remindedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  autoPublishedAt!: Date | null;
}
