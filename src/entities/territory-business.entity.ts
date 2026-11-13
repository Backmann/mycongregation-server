import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A business on the list of a business territory (13 November 2026): a
 * name, a kind and a point — taken from the map (`osmId`) or added by hand.
 * No notes: what the list says must never be about people.
 */
@Entity('territory_businesses')
@Index(['territoryId'])
export class TerritoryBusiness {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  territoryId!: string;

  /** bigint as a string; null when added by hand. */
  @Column({ type: 'bigint', nullable: true })
  osmId!: string | null;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 40 })
  kind!: string;

  @Column({ type: 'double precision', nullable: true })
  lon!: number | null;

  @Column({ type: 'double precision', nullable: true })
  lat!: number | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
