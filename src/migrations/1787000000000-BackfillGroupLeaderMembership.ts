import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time backfill: a group's overseer and assistant are members of the group
 * they lead, so their publisher.service_group_id should point at that group.
 * Going forward this is maintained by ServiceGroupsService on create/update.
 */
export class BackfillGroupLeaderMembership1787000000000 implements MigrationInterface {
  name = 'BackfillGroupLeaderMembership1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE publishers p
      SET service_group_id = g.id
      FROM service_groups g
      WHERE g.deleted_at IS NULL
        AND p.congregation_id = g.congregation_id
        AND (p.id = g.overseer_publisher_id OR p.id = g.assistant_publisher_id)
        AND p.service_group_id IS DISTINCT FROM g.id
    `);
  }

  public async down(): Promise<void> {
    // Data backfill — no reliable inverse.
  }
}
