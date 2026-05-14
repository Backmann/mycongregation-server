import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenEncryptedColumns1779000000000 implements MigrationInterface {
  name = 'WidenEncryptedColumns1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Widen varchar columns that will hold AES-256-GCM ciphertext.
    // Encrypted values are ~85 bytes longer than plaintext, so size-limited
    // columns cannot fit them. Switching to unbounded text.
    //
    // Companion to data-protection.md Phase 1: applies to columns where
    // encryptedTransformer is now active on their entity definitions.
    await queryRunner.query(`ALTER TABLE "publishers" ALTER COLUMN "mobile_phone" TYPE text`);
    await queryRunner.query(`ALTER TABLE "publishers" ALTER COLUMN "email" TYPE text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse widening. Safe only if no encrypted values are stored yet,
    // since ciphertext does not fit back into the original varchar sizes.
    await queryRunner.query(`ALTER TABLE "publishers" ALTER COLUMN "email" TYPE varchar(255)`);
    await queryRunner.query(`ALTER TABLE "publishers" ALTER COLUMN "mobile_phone" TYPE varchar(32)`);
  }
}
