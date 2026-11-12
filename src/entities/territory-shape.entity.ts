import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { TerritoryGeometry } from './territory.entity';

export interface ReshapeDetail {
  /** The territory made by a cut or created anew. */
  made?: string;
  /** The territory put out of use by a join. */
  archived?: string;
  /** «Не посещать» addresses moved, and the territory each came from. */
  noCalls?: { id: string; from: string }[];
}

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

  /** Why: 'import', 'edit', 'undo', 'split', 'merge', 'new', 'unsplit', 'unmerge'. */
  @Column({ type: 'varchar', length: 12 })
  reason!: string;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  fromTerritoryIds!: string[];

  /**
   * One change by hand that may touch several territories (a shared border
   * moves in both); «undo» puts back every outline with the same id.
   */
  @Column({ type: 'uuid', nullable: true })
  editId!: string | null;

  /**
   * What a cut, a join or a new territory did besides the outlines, for
   * «undo»: {made, archived, noCalls: [{id, from}]}. Null for plain edits.
   */
  @Column({ type: 'jsonb', nullable: true })
  detail!: ReshapeDetail | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
