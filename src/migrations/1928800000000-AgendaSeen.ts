import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What each person last saw of their own coming items on Home, for
 * «изменено» (9 November 2026). See entities/agenda-seen.entity.ts.
 */
export class AgendaSeen1928800000000 implements MigrationInterface {
  name = 'AgendaSeen1928800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agenda_seen" (
        "user_id" uuid NOT NULL,
        "item_id" character varying(160) NOT NULL,
        "congregation_id" uuid NOT NULL,
        "date" date NOT NULL,
        "start" character varying(5),
        "title" text NOT NULL,
        "with" jsonb NOT NULL DEFAULT '[]',
        "place" text,
        "seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agenda_seen" PRIMARY KEY ("user_id", "item_id"),
        CONSTRAINT "FK_agenda_seen_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agenda_seen_congregation" FOREIGN KEY ("congregation_id")
          REFERENCES "congregations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_agenda_seen_congregation" ON "agenda_seen" ("congregation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agenda_seen"`);
  }
}
