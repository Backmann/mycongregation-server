import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * The one notice already sent about assignments on a meeting that is not held
 * — so the person who keeps the programme hears of it once, not every quarter
 * of an hour. Dropped when nothing is left there, so a new case is told again.
 */
@Entity('not_held_alerts')
export class NotHeldAlert {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  @PrimaryColumn({ type: 'date' })
  weekStartDate!: string;

  @PrimaryColumn({ type: 'varchar', length: 16 })
  eventType!: string;

  @Column({ type: 'int' })
  count!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  alertedAt!: Date;
}
