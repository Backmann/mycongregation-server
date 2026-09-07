import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The weekend programme learns WHICH visiting speaker, not just his name.
 *
 * Until now the public-talk slot held only `speaker_name` — text. The journal
 * held a real link to the directory card, and that link is what a brother's
 * history is built from: a visit counts for him only when the entry points at
 * his card. The two mirrors then undid each other. Journal → programme wrote
 * the name as text; programme → journal read that text back, failed to match
 * it against a linked entry, and cleared the link. From that moment the visit
 * belonged to nobody: the card said «ещё не приезжал», the interval reset, and
 * the talk he had given counted as never given.
 *
 * Nothing was lost from the journal itself — the row stayed, the name stayed —
 * which is why it looked like a mystery rather than a fault.
 *
 * One nullable column ends it. Null keeps its old meaning: a name typed by
 * hand, not yet matched to anyone.
 */
export class AssignmentVisitingSpeaker1883000000000 implements MigrationInterface {
  name = 'AssignmentVisitingSpeaker1883000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assignments"
      ADD COLUMN IF NOT EXISTS "visiting_speaker_id" uuid
    `);
    // SET NULL rather than RESTRICT: deleting a card must not make a past
    // programme unreadable. The name stays in speaker_name either way, so the
    // week still says who spoke.
    await queryRunner.query(`
      ALTER TABLE "assignments"
      ADD CONSTRAINT "FK_assignments_visiting_speaker"
      FOREIGN KEY ("visiting_speaker_id")
      REFERENCES "visiting_speakers"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_assignments_visiting_speaker"
      ON "assignments" ("visiting_speaker_id")
    `);

    // Карточка, заведённая приложением по имени из программы: у неё нет ни
    // телефона, ни репертуара, и это стоит показывать координатору, а не
    // выдавать за заполненный справочник.
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers"
      ADD COLUMN IF NOT EXISTS "auto_created" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "visiting_speakers" DROP COLUMN IF EXISTS "auto_created"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_assignments_visiting_speaker"
    `);
    await queryRunner.query(`
      ALTER TABLE "assignments"
      DROP CONSTRAINT IF EXISTS "FK_assignments_visiting_speaker"
    `);
    await queryRunner.query(`
      ALTER TABLE "assignments" DROP COLUMN IF EXISTS "visiting_speaker_id"
    `);
  }
}
