import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three circumstances the annual congregation report (S-10) asks about:
 * publishers who are deaf and need sign-language interpretation, publishers
 * who are blind, and publishers in prison.
 *
 * Kept as plain booleans rather than encrypted text, unlike a phone number.
 * A phone number leaks the moment it is read; a flag means nothing without the
 * row it sits on, and that row is already behind tenant isolation. What these
 * need is not concealment from the database but restraint in the API: they are
 * pastoral information, so they are stripped from any response that does not
 * go to an administrator or an elder — the same treatment the computed service
 * status already gets.
 *
 * They live on the card rather than being typed once a year so the yearly
 * figures come out right on their own instead of depending on somebody
 * remembering every September.
 */
export class AddPublisherCircumstances1849000000000 implements MigrationInterface {
  name = 'AddPublisherCircumstances1849000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "publishers"
        ADD COLUMN IF NOT EXISTS "is_deaf" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "is_blind" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "is_imprisoned" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "publishers"
        DROP COLUMN IF EXISTS "is_deaf",
        DROP COLUMN IF EXISTS "is_blind",
        DROP COLUMN IF EXISTS "is_imprisoned"
    `);
  }
}
