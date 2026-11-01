import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Five places that name a publisher card without the database knowing it
 * (1 November 2026): a group's overseer and assistant, the service overseer
 * and his assistant on a field-service visit, a task's single assignee (the
 * field kept beside the list), and the brother hosting the circuit overseer.
 *
 * Nothing held them. «Удалить насовсем» asks the database what still points
 * at a card and was told nothing about these, so a group's overseer could be
 * deleted and the group kept pointing at nobody. Merging two cards would
 * have missed them the same way. Now they are keys like every other link:
 * the database answers for them, and whatever lists a card's links — today
 * the delete check, tomorrow the merge — finds them without being told.
 *
 * An id that already points at a card no longer there is cleared first: it
 * names nobody, and a key cannot be added over it. The count is written to
 * the log so it is known, not guessed.
 */
const LINKS: { table: string; column: string }[] = [
  { table: 'service_groups', column: 'overseer_publisher_id' },
  { table: 'service_groups', column: 'assistant_publisher_id' },
  { table: 'field_service_meetings', column: 'service_overseer_publisher_id' },
  { table: 'field_service_meetings', column: 'service_overseer_assistant_id' },
  { table: 'elder_tasks', column: 'assignee_publisher_id' },
  { table: 'special_events', column: 'co_accommodation_publisher_id' },
];

const keyName = (table: string, column: string) => `fk_${table}_${column}`;

export class CardLinksAreKeys1928000000000 implements MigrationInterface {
  name = 'CardLinksAreKeys1928000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column } of LINKS) {
      const cleared: unknown[] = await queryRunner.query(
        `UPDATE "${table}" t SET "${column}" = NULL
          WHERE t."${column}" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "publishers" p WHERE p."id" = t."${column}")
        RETURNING 1`,
      );
      const n = Array.isArray(cleared[0]) ? cleared[0].length : cleared.length;
      if (n > 0) {
        console.log(
          `CardLinksAreKeys: ${table}.${column} — cleared ${n} id(s) naming no card`,
        );
      }
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${keyName(table, column)}"
           FOREIGN KEY ("${column}") REFERENCES "publishers"("id") ON DELETE SET NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column } of LINKS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${keyName(table, column)}"`,
      );
    }
  }
}
