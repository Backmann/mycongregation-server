import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * «This turn of this thing has already been offered.»
 *
 * Kept apart from the task itself because it must outlive it: a task deleted
 * on purpose must not reappear tomorrow, and a deleted row cannot remember
 * anything.
 */
@Entity('elder_task_calendar_log')
export class ElderTaskCalendarLog {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  @PrimaryColumn({ type: 'varchar', length: 30 })
  kind!: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  period!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
