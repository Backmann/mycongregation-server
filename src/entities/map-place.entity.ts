import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One named place of the congregation's map (13 November 2026): a shop, a
 * café, a doctor's practice… Its OpenStreetMap id, kind, name and point.
 * Public map data, rebuilt whole when the map is cut
 * (.github/workflows/map.yml, scripts/map-places.mjs).
 */
@Entity('map_places')
export class MapPlace {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  /** bigint: TypeORM hands it over as a string. */
  @PrimaryColumn({ type: 'bigint' })
  osmId!: string;

  @Column({ type: 'varchar', length: 40 })
  kind!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'double precision' })
  lon!: number;

  @Column({ type: 'double precision' })
  lat!: number;
}
