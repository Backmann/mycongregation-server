import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An account that has no address at all.
 *
 * Forty-four of the ninety-two people here have no e-mail written anywhere,
 * and granting access demanded one. The choice was «no login» or «invent an
 * address» — and an invented address is worse than none: it looks like a way
 * to reach somebody and is not.
 *
 * Safe on its own only because the code invitation lands in the same patch:
 * an account with no password AND no address can be entered by its code, and
 * until that was true, this column would have been a way to create logins
 * nobody could ever use.
 */
export class EmailIsOptional1872000000000 implements MigrationInterface {
  name = 'EmailIsOptional1872000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Going back needs every row to have an address again. Refusing loudly is
    // right: silently inventing one would hand somebody a login that mails a
    // stranger.
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL`,
    );
  }
}
