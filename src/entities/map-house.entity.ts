import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One building of the congregation's map (12 November 2026): its
 * OpenStreetMap id, its middle and its footprint. Public map data, rebuilt
 * whole when the map is cut (.github/workflows/map.yml).
 */
@Entity('map_houses')
export class MapHouse {
  @PrimaryColumn({ type: 'uuid' })
  congregationId!: string;

  /** bigint: TypeORM hands it over as a string. */
  @PrimaryColumn({ type: 'bigint' })
  osmId!: string;

  @Column({ type: 'double precision' })
  lon!: number;

  @Column({ type: 'double precision' })
  lat!: number;

  @Column({ type: 'integer' })
  areaM2!: number;

  /** House numbers of the building, «12;12a;14» (13 November 2026); null: none known. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  numbers!: string | null;

  /**
   * A home, counted as doors (14 November 2026). False for a garage or shed
   * without an address of its own — set by `mark_homes()` (migration
   * MapHomes), the one place the rule lives.
   */
  @Column({ type: 'boolean', default: true })
  home!: boolean;

  /**
   * What the cadastre (ALKIS NW) says the building is, «Wohngebäude» …;
   * null when unknown (14 November 2026, migration MapOfficialUse).
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  official!: string | null;

  /**
   * The cadastre's building this house is (a piece of); null when unknown.
   * Several houses of the map may share one (migration MapOfficialId).
   */
  @Column({ name: 'official_id', type: 'varchar', length: 64, nullable: true })
  officialId!: string | null;

  /** Floors above ground, from the cadastre; null when unknown. */
  @Column({ type: 'smallint', nullable: true })
  floors!: number | null;
}
