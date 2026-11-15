import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The drivable roads with no name (15 November 2026): the roads between
 * villages often carry only a number, so map_streets — named streets, for
 * dividing a territory — leaves them out, and the minutes from the halls
 * came out too long in the east (Uentrop 20 minutes instead of 13). Rebuilt
 * with the map (scripts/map-streets.mjs --unnamed-roads); read only to tell
 * how far a territory is from the halls, never to divide one.
 */
export class MapRoads1931400000000 implements MigrationInterface {
  name = 'MapRoads1931400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "map_roads" (
        "congregation_id" uuid NOT NULL,
        "road_no" integer NOT NULL,
        "kind" character varying(32) NOT NULL,
        "west" double precision NOT NULL,
        "south" double precision NOT NULL,
        "east" double precision NOT NULL,
        "north" double precision NOT NULL,
        "lines" jsonb NOT NULL,
        CONSTRAINT "PK_map_roads" PRIMARY KEY ("congregation_id", "road_no"),
        CONSTRAINT "FK_map_roads_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "map_roads"`);
  }
}
