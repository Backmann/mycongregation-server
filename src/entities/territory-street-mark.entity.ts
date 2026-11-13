import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * «Street walked» while a territory is given out (13 November 2026): the
 * houses of that street (or piece of one) as the division had them, and when.
 * Never who. Tied to the assignment, deleted when the territory comes back;
 * the next division of the territory leaves these houses out.
 */
@Entity('territory_street_marks')
@Index('UQ_territory_street_marks', ['assignmentId', 'streetKey'], {
  unique: true,
})
export class TerritoryStreetMark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  assignmentId!: string;

  @Column({ type: 'varchar', length: 220 })
  streetKey!: string;

  /** OpenStreetMap ids of the houses walked. */
  @Column({ type: 'jsonb' })
  homes!: string[];

  @Column({ type: 'timestamptz' })
  markedAt!: Date;
}
