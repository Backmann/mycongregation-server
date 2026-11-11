import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { TerritoryGeometry } from './territory.entity';

/**
 * An earlier outline of a territory, kept when it is replaced (11 November
 * 2026). When a territory is split or merged the new ones name where they
 * came from in `fromTerritoryIds`, so its history can still be followed.
 */
@Entity('territory_shapes')
@Index(['territoryId'])
export class TerritoryShape {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'uuid' })
  territoryId!: string;

  @Column({ type: 'jsonb' })
  geometry!: TerritoryGeometry;

  /** Why: 'import', 'edit', 'split', 'merge'. */
  @Column({ type: 'varchar', length: 12 })
  reason!: string;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  fromTerritoryIds!: string[];

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
