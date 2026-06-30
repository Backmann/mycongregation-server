import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * One recurring slot of a congregation's field-service meeting template, e.g.
 * "1st Saturday · 10:30 · Kingdom Hall Hamm". The generator turns each slot
 * into real meetings on the matching ordinal weekday of each month. Edited as
 * a whole set (replace-all); `position` preserves display order.
 */
@Entity('field_service_template_slots')
@Index(['congregationId'])
export class FieldServiceTemplateSlot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'int' })
  position!: number;

  @Column({ type: 'int', comment: 'Nth occurrence in the month, 1-5' })
  ordinal!: number;

  @Column({ type: 'int', comment: '1=Mon .. 7=Sun' })
  dayOfWeek!: number;

  @Column({ type: 'varchar', length: 5, comment: '"HH:MM" 24h' })
  startTime!: string;

  @Column({ type: 'varchar', length: 255 })
  address!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
