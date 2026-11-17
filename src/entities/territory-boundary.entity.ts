import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { TerritoryGeometry } from './territory.entity';

/**
 * The boundary of the congregation's whole territory, one row per version;
 * the newest is the one in force (11 November 2026). The words that come
 * with it — what lies north, east, south and west — are kept as given.
 */
@Entity('territory_boundaries')
@Index(['congregationId'])
export class TerritoryBoundary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @Column({ type: 'jsonb' })
  geometry!: TerritoryGeometry;

  /** {north, east, south, west} as written on the assignment, or null. */
  @Column({ type: 'jsonb', nullable: true })
  description!: Record<string, string> | null;

  /** The date the boundary itself carries, if any. */
  @Column({ type: 'date', nullable: true })
  validFrom!: string | null;

  /**
   * The date of the branch's «Назначение территории собрания» (S-54) this
   * boundary follows (17 November 2026). The boundary is the branch's: in
   * the app it is only replaced by a new file from the branch.
   */
  @Column({ type: 'date', nullable: true })
  s54On!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
