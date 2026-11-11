import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The territory a meeting for field service goes out to (11 November
 * 2026): chosen by its conductor from his own or his group's, and seen by
 * whoever the meeting is for, the day before and on the day.
 */
export class FieldServiceMeetingTerritory1929700000000 implements MigrationInterface {
  name = 'FieldServiceMeetingTerritory1929700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" ADD COLUMN IF NOT EXISTS "territory_id" uuid`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "field_service_meetings"
          ADD CONSTRAINT "FK_field_service_meetings_territory"
          FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP CONSTRAINT IF EXISTS "FK_field_service_meetings_territory"`,
    );
    await queryRunner.query(
      `ALTER TABLE "field_service_meetings" DROP COLUMN IF EXISTS "territory_id"`,
    );
  }
}
