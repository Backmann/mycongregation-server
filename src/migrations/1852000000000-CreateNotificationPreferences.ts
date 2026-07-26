import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a person choose what to hear about.
 *
 * Only the switched-off categories are stored — absence means "on", so the
 * default costs nothing and nobody misses an assignment because they never
 * opened the settings.
 */
export class CreateNotificationPreferences1852000000000 implements MigrationInterface {
  name = 'CreateNotificationPreferences1852000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "category" character varying(32) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notification_preferences" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_preferences_user_category"
        ON "notification_preferences" ("user_id", "category")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_preferences"`);
  }
}
