import { MigrationInterface, QueryRunner } from 'typeorm';

/** «С кем»: the cards a wish names, chosen from the list (2 November 2026). */
export class CartRequestPartners1928300000000 implements MigrationInterface {
  name = 'CartRequestPartners1928300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cart_request_partners" (
        "request_id" uuid NOT NULL REFERENCES "cart_requests"("id") ON DELETE CASCADE,
        "publisher_id" uuid NOT NULL REFERENCES "publishers"("id") ON DELETE CASCADE,
        CONSTRAINT "pk_cart_request_partners" PRIMARY KEY ("request_id", "publisher_id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "ix_cart_request_partners_publisher" ON "cart_request_partners" ("publisher_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cart_request_partners"`);
  }
}
