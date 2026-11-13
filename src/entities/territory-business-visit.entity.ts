import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type BusinessVisitState = 'visited' | 'later';

/**
 * «Visited» or «closed — again later» for one business while its territory
 * is given out (13 November 2026). Tied to that assignment and deleted when
 * the territory comes back; only the day is kept, never who.
 */
@Entity('territory_business_visits')
@Index(['businessId', 'assignmentId'], { unique: true })
export class TerritoryBusinessVisit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  businessId!: string;

  @Column({ type: 'uuid' })
  assignmentId!: string;

  @Column({ type: 'varchar', length: 10 })
  state!: BusinessVisitState;

  @Column({ type: 'date' })
  onDate!: string;
}
