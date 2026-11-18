import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { CoNoticeLine } from '../co-visit-items/co-visit-notice';

/**
 * What one person was last told about a circuit overseer's visit — the
 * lines a later word compares with (18 November 2026).
 */
@Entity('co_visit_told')
@Unique('UQ_co_visit_told_person', ['specialEventId', 'publisherId'])
export class CoVisitTold {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'congregation_id' })
  congregationId!: string;

  @Column({ type: 'uuid', name: 'special_event_id' })
  specialEventId!: string;

  @Column({ type: 'uuid', name: 'publisher_id' })
  publisherId!: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  lines!: CoNoticeLine[];

  @Column({ type: 'timestamptz', name: 'told_at', default: () => 'now()' })
  toldAt!: Date;
}
