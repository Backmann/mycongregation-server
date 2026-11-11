import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Congregation } from './congregation.entity';
import { encryptedTransformer } from '../crypto/encrypted.transformer';

/** A polygon or several, as GeoJSON stores them: [lon, lat] pairs. */
export interface TerritoryGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export type TerritoryKind = 'city' | 'suburb' | 'village';
export const TERRITORY_KINDS: TerritoryKind[] = ['city', 'suburb', 'village'];

/**
 * One territory of the congregation (11 November 2026).
 *
 * Its number is given once and kept: it is what the S-13 and the printed
 * card say, and what people call it by. The outline lives here as the
 * current version; every earlier one is kept in territory_shapes, so a
 * changed boundary never rewrites what an old record meant.
 *
 * `lastCompletedOn` is the column the S-13 asks for when a new sheet is
 * begun: the last date the territory was worked, carried forward when older
 * service years are erased (only the current and the previous year are
 * kept, sfga records table).
 */
@Entity('territories')
@Index(['congregationId'])
export class Territory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  congregationId!: string;

  @ManyToOne(() => Congregation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'congregation_id' })
  congregation!: Congregation;

  @Column({ type: 'varchar', length: 40 })
  number!: string;

  /** The town or district, as the congregation names it. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  locality!: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  kind!: TerritoryKind | null;

  @Column({ type: 'jsonb' })
  geometry!: TerritoryGeometry;

  /** Notes for those who keep the territories — may name a place, so sealed. */
  @Column({ type: 'text', nullable: true, transformer: encryptedTransformer })
  note!: string | null;

  @Column({ type: 'date', nullable: true })
  lastCompletedOn!: string | null;

  /** Taken out of use; its history stays until it ages out. */
  @Column({ type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
