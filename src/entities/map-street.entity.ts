import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One named street of the congregation's map (13 November 2026): its name,
 * its kind and its line, with the box round it. Pieces of one name that meet
 * are one street; the same name in the next village is another. Public map
 * data, rebuilt whole when the map is cut (.github/workflows/map.yml,
 * scripts/map-streets.mjs). Used to divide a territory between groups.
 */
@Entity('map_streets')
export class MapStreet {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  @PrimaryColumn({ type: 'integer' })
  streetNo!: number;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 40 })
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
