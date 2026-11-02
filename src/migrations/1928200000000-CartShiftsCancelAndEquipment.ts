import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The public-witnessing section made ready for use (2 November 2026).
 *
 *  - `cart_weeks.published_at`: when the week was published. A wish made
 *    before it and not granted is, from then on, simply not shown to the
 *    person (Lionel: no message to whoever was not chosen — he sees he is
 *    not on the list); a wish made after it is a real request for a free
 *    place and stays one.
 *  - `cart_slots.cancelled_*`: a shift called off by whoever arranges them —
 *    bad weather, an unsafe day in town — keeps its crew, so it can be put
 *    back as it was.
 *  - `cart_locations.equipment_at`: where the cart or the stand is fetched
 *    from; the service committee decides where it is kept.
 */
export class CartShiftsCancelAndEquipment1928200000000 implements MigrationInterface {
  name = 'CartShiftsCancelAndEquipment1928200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cart_weeks" ADD "published_at" timestamptz`,
    );
    // Weeks published before this column existed: the last change of a
    // published week is its publication — nothing else edits the row after.
    await queryRunner.query(
      `UPDATE "cart_weeks" SET "published_at" = "updated_at" WHERE "status" = 'published'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_slots" ADD "cancelled_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_slots" ADD "cancel_reason" varchar(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_slots" ADD "cancelled_by_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_locations" ADD "equipment_at" varchar(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cart_locations" DROP COLUMN "equipment_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_slots" DROP COLUMN "cancelled_by_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_slots" DROP COLUMN "cancel_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_slots" DROP COLUMN "cancelled_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cart_weeks" DROP COLUMN "published_at"`,
    );
  }
}
