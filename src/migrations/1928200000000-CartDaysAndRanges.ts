import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The stand served as it is really served (2 November 2026).
 *
 * Until now a week was cut into shifts of one length, and a person took a
 * whole shift or nothing. In the congregation one stands an hour, another an
 * hour and a half, a third two or three, sometimes once in the morning and
 * again after lunch (Lionel, and the brother who arranges the carts). So:
 *
 *  - `cart_days`: a place on a date with its hours — «четверг, Ahlen,
 *    07:00–16:00». It replaces `cart_slots`.
 *  - a wish and a place on the plan are a span of that day, from — to, on the
 *    half-hour: `cart_requests` and `cart_assignments` get `day_id`,
 *    `start_time`, `end_time`. Several per person and day.
 *  - `cart_cancellations`: a day, or part of it, called off — bad weather, an
 *    unsafe day in town. The plan stays as it was, so it can be put back.
 *  - `cart_weeks.published_at` and `signup_until`; `cart_locations`
 *    `equipment_at` and `permit_until`; `cart_settings.memo`.
 *
 * What was planned in the old shape is carried over: the shifts of one place
 * on one date become one day from the first to the last; each wish and each
 * place on the plan keeps its shift's hours.
 */
export class CartDaysAndRanges1928200000000 implements MigrationInterface {
  name = 'CartDaysAndRanges1928200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "cart_weeks" ADD "published_at" timestamptz`);
    await q.query(`ALTER TABLE "cart_weeks" ADD "signup_until" date`);
    // The last change of a week published before this column existed is its
    // publication — nothing else edits the row afterwards.
    await q.query(
      `UPDATE "cart_weeks" SET "published_at" = "updated_at" WHERE "status" = 'published'`,
    );
    await q.query(
      `ALTER TABLE "cart_locations" ADD "equipment_at" varchar(255)`,
    );
    await q.query(`ALTER TABLE "cart_locations" ADD "permit_until" date`);

    await q.query(`
      CREATE TABLE "cart_days" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "week_id" uuid NOT NULL,
        "date" date NOT NULL,
        "location_id" uuid NOT NULL,
        "start_time" varchar(5) NOT NULL,
        "end_time" varchar(5) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cart_days" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cart_days_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cart_days_week" FOREIGN KEY ("week_id") REFERENCES "cart_weeks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_cart_days_location" FOREIGN KEY ("location_id") REFERENCES "cart_locations"("id") ON DELETE RESTRICT,
        CONSTRAINT "uq_cart_day_week_date_location" UNIQUE ("week_id", "date", "location_id")
      )`);
    await q.query(
      `CREATE INDEX "IDX_cart_days_cong_date" ON "cart_days" ("congregation_id", "date")`,
    );
    await q.query(`
      INSERT INTO "cart_days" (congregation_id, week_id, date, location_id, start_time, end_time)
      SELECT congregation_id, week_id, date, location_id, min(start_time), max(end_time)
        FROM "cart_slots" GROUP BY congregation_id, week_id, date, location_id`);

    for (const t of ['cart_requests', 'cart_assignments']) {
      await q.query(`ALTER TABLE "${t}" ADD "day_id" uuid`);
      await q.query(`ALTER TABLE "${t}" ADD "start_time" varchar(5)`);
      await q.query(`ALTER TABLE "${t}" ADD "end_time" varchar(5)`);
      await q.query(`
        UPDATE "${t}" x SET day_id = d.id, start_time = s.start_time, end_time = s.end_time
          FROM "cart_slots" s
          JOIN "cart_days" d ON d.week_id = s.week_id AND d.date = s.date AND d.location_id = s.location_id
         WHERE x.slot_id = s.id`);
      await q.query(`DELETE FROM "${t}" WHERE day_id IS NULL`);
      await q.query(`ALTER TABLE "${t}" ALTER "day_id" SET NOT NULL`);
      await q.query(`ALTER TABLE "${t}" ALTER "start_time" SET NOT NULL`);
      await q.query(`ALTER TABLE "${t}" ALTER "end_time" SET NOT NULL`);
      await q.query(
        `ALTER TABLE "${t}" ADD CONSTRAINT "FK_${t}_day" FOREIGN KEY ("day_id") REFERENCES "cart_days"("id") ON DELETE CASCADE`,
      );
      await q.query(`CREATE INDEX "IDX_${t}_day" ON "${t}" ("day_id")`);
    }
    await q.query(
      `ALTER TABLE "cart_requests" DROP CONSTRAINT "uq_cart_request_slot_publisher"`,
    );
    await q.query(
      `ALTER TABLE "cart_assignments" DROP CONSTRAINT "uq_cart_assignment_slot_publisher"`,
    );
    await q.query(`ALTER TABLE "cart_requests" DROP COLUMN "slot_id"`);
    await q.query(`ALTER TABLE "cart_assignments" DROP COLUMN "slot_id"`);
    await q.query(
      `ALTER TABLE "cart_assignments" ADD "updated_at" timestamptz NOT NULL DEFAULT now()`,
    );
    await q.query(`DROP TABLE "cart_slots"`);

    await q.query(`
      CREATE TABLE "cart_cancellations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "congregation_id" uuid NOT NULL,
        "day_id" uuid NOT NULL,
        "start_time" varchar(5) NOT NULL,
        "end_time" varchar(5) NOT NULL,
        "reason" varchar(200),
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cart_cancellations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cart_cancellations_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cart_cancellations_day" FOREIGN KEY ("day_id") REFERENCES "cart_days"("id") ON DELETE CASCADE
      )`);
    await q.query(
      `CREATE INDEX "IDX_cart_cancellations_day" ON "cart_cancellations" ("day_id")`,
    );
    await q.query(`
      CREATE TABLE "cart_settings" (
        "congregation_id" uuid NOT NULL,
        "memo" text,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cart_settings" PRIMARY KEY ("congregation_id"),
        CONSTRAINT "FK_cart_settings_congregation" FOREIGN KEY ("congregation_id") REFERENCES "congregations"("id") ON DELETE CASCADE
      )`);
  }

  public async down(): Promise<void> {
    // The old shape cannot hold a span that does not fit a shift: going back
    // would lose what people asked for. Restore from the backup instead.
    throw new Error('CartDaysAndRanges cannot be reverted; restore a backup');
  }
}
