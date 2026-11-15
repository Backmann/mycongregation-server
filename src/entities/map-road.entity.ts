import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * A drivable road with no name (15 November 2026): a piece of a road
 * between villages that carries only a number. With map_streets, the roads
 * one drives on — to tell how far a territory is from the halls. Public map
 * data, rebuilt with the map (scripts/map-streets.mjs --unnamed-roads).
 */
@Entity('map_roads')
export class MapRoad {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  @PrimaryColumn({ type: 'integer' })
  roadNo!: number;

  @Column({ type: 'varchar', length: 32 })
  kind!: string;

  @Column({ type: 'double precision' })
  west!: number;

  @Column({ type: 'double precision' })
  south!: number;

  @Column({ type: 'double precision' })
  east!: number;

  @Column({ type: 'double precision' })
  north!: number;

  /** [[lon, lat], …] lines. */
  @Column({ type: 'jsonb' })
  lines!: [number, number][][];
}
