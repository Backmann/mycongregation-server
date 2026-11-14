import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One official address of the congregation's map area (14 November 2026):
 * «Gebäudereferenzen NW», Geobasis NRW, Datenlizenz Deutschland – Zero 2.0.
 * Street, number and point of a main building; no names, no owners.
 * Rebuilt whole with the map (.github/workflows/map.yml,
 * scripts/map-addresses.mjs). Gives a house its own street when a
 * territory is divided.
 */
@Entity('map_addresses')
export class MapAddress {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  /** The cadastre's own id of the building reference. */
  @PrimaryColumn({ type: 'varchar', length: 16 })
  oid!: string;

  @Column({ type: 'double precision' })
  lon!: number;

  @Column({ type: 'double precision' })
  lat!: number;

  /** «12», «12a». */
  @Column({ type: 'varchar', length: 16 })
  number!: string;

  @Column({ type: 'varchar', length: 200 })
  street!: string;
}
