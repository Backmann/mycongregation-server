import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The cards made from half-typed guest names (23 October 2026).
 *
 * Until this release a name typed into the weekend programme became a card
 * at its first few letters, and the programme slot kept that card when the
 * rest of the name arrived. Live data that day: one past slot linked to a
 * two-letter card while its text named a real card exactly, and one card the
 * application had made with no visit at all.
 *
 * 1. A slot or a journal entry linked to a card the APPLICATION made, whose
 *    name is not the text the row shows, moves to the card that IS that text
 *    — only when exactly one live card carries it. Two namesakes: left as it
 *    is, a person tells them apart.
 * 2. A card the application made that nothing points at — not a live row,
 *    not a removed one, not a card merged into it — and that nobody added a
 *    phone, a note or a talk to, is removed softly. A card a person made or
 *    filled in is never touched.
 *
 * Past weeks are put right too: the link is bookkeeping, the name the
 * programme shows does not change.
 */
export class GuestCardsFromHalfTypedNames1912000000000 implements MigrationInterface {
  name = 'GuestCardsFromHalfTypedNames1912000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const norm = (expr: string) =>
      `lower(trim(regexp_replace(${expr}, '\\s+', ' ', 'g')))`;
    const fwd = (t: string) =>
      norm(`concat_ws(' ', ${t}.first_name, ${t}.last_name)`);
    const rev = (t: string) =>
      norm(`concat_ws(' ', ${t}.last_name, ${t}.first_name)`);

    for (const table of ['assignments', 'talk_exchange']) {
      const only =
        table === 'assignments'
          ? `r.part_key = 'public_talk_speaker'`
          : `r.direction = 'incoming'`;
      await queryRunner.query(`
        UPDATE "${table}" r
           SET visiting_speaker_id = (
                 SELECT o.id FROM visiting_speakers o
                  WHERE o.congregation_id = r.congregation_id
                    AND o.deleted_at IS NULL AND o.merged_into_id IS NULL
                    AND ${norm('r.speaker_name')} IN (${fwd('o')}, ${rev('o')}))
          FROM visiting_speakers c
         WHERE c.id = r.visiting_speaker_id
           AND ${only}
           AND r.deleted_at IS NULL
           AND coalesce(r.speaker_name, '') <> ''
           AND c.auto_created
           AND ${norm('r.speaker_name')} NOT IN (${fwd('c')}, ${rev('c')})
           AND (SELECT count(*) FROM visiting_speakers o
                 WHERE o.congregation_id = r.congregation_id
                   AND o.deleted_at IS NULL AND o.merged_into_id IS NULL
                   AND ${norm('r.speaker_name')} IN (${fwd('o')}, ${rev('o')})) = 1
      `);
    }

    await queryRunner.query(`
      UPDATE visiting_speakers v
         SET deleted_at = now()
       WHERE v.auto_created
         AND v.deleted_at IS NULL
         AND NOT v.circuit_overseer
         AND v.merged_into_id IS NULL
         AND v.phone IS NULL
         AND v.note IS NULL
         AND coalesce(array_length(v.talk_numbers, 1), 0) = 0
         AND NOT EXISTS (SELECT 1 FROM talk_exchange t WHERE t.visiting_speaker_id = v.id)
         AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.visiting_speaker_id = v.id)
         AND NOT EXISTS (SELECT 1 FROM visiting_speakers m WHERE m.merged_into_id = v.id)
    `);
  }

  public async down(): Promise<void> {
    // A repair of data: the cards removed are soft-deleted and can be
    // restored one by one; nothing here is worth undoing wholesale.
  }
}
