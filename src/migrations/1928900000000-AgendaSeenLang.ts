import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The language of what a person last saw on Home (9 November 2026): titles
 * are compared only within one language, so switching the app's language
 * does not mark every row «изменено». Old rows stay null — not compared.
 */
export class AgendaSeenLang1928900000000 implements MigrationInterface {
  name = 'AgendaSeenLang1928900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agenda_seen" ADD COLUMN IF NOT EXISTS "lang" character varying(8)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agenda_seen" DROP COLUMN IF EXISTS "lang"`,
    );
  }
}
