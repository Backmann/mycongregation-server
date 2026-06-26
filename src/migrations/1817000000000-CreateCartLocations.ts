import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCartLocations1817000000000 implements MigrationInterface {
  name = 'CreateCartLocations1817000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cart_locations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "congregation_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "address" character varying(255), "kind" character varying(8) NOT NULL DEFAULT 'cart', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cart_locations" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cart_locations_congregation" ON "cart_locations" ("congregation_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_locations" ADD CONSTRAINT "FK_cart_locations_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cart_locations" DROP CONSTRAINT "FK_cart_locations_congregation"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_cart_locations_congregation"`);
    await queryRunner.query(`DROP TABLE "cart_locations"`);
  }
}
