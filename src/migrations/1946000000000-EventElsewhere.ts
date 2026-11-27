import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where an event is held when it is not the hall (27 November 2026): the
 * Memorial is sometimes elsewhere, and the address is often not known weeks
 * ahead. False for every row there is: in the hall unless an address says
 * otherwise — exactly what the app assumed before.
 */
export class EventElsewhere1946000000000 implements MigrationInterface {
  name = 'EventElsewhere1946000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" ADD COLUMN "elsewhere" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "special_events" DROP COLUMN "elsewhere"`,
    );
  }
}
