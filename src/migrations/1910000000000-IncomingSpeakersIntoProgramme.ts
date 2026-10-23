import { MigrationInterface, QueryRunner } from 'typeorm';
import { IncomingSlotRow, planSlot } from '../talk-exchange/incoming-slot-plan';

/**
 * The visits already arranged reach the programme (23 October 2026).
 *
 * Until server #20 a «К нам» entry with a speaker but no talk yet never went
 * into a week that already existed — the programme kept an empty line while
 * the coordinator saw the visit arranged. #20 fixed the save; it did not go
 * back over the entries saved before it, and those are exactly the ones
 * Lionel still saw missing («в программе они не отображаются»).
 *
 * This goes over them once, by the rules of fillEmptySlot: an upcoming week,
 * the weekend public-talk line, and only where nobody is named yet. A line
 * with another speaker, or with another talk, is somebody's decision and is
 * left alone. Of several entries in one week the first by date counts, as
 * there. A week whose meeting has passed is the record and is not touched.
 */

export class IncomingSpeakersIntoProgramme1910000000000 implements MigrationInterface {
  name = 'IncomingSpeakersIntoProgramme1910000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: IncomingSlotRow[] = await queryRunner.query(`
      SELECT DISTINCT ON (a.id)
        a.id AS slot_id, a.status AS slot_status,
        a.public_talk_id AS slot_talk_id, a.special_talk AS slot_special,
        a.part_title AS slot_title,
        te.publisher_id, te.visiting_speaker_id,
        CASE WHEN vs.id IS NOT NULL
          THEN concat_ws(' ', NULLIF(vs.first_name, ''), NULLIF(vs.last_name, ''))
        END AS vs_name,
        ec.name AS vs_cong,
        te.speaker_name, te.speaker_congregation,
        te.public_talk_id,
        CASE WHEN pt.id IS NOT NULL THEN '№' || pt.number || '. ' || pt.title END AS talk_label,
        te.special_theme
      FROM talk_exchange te
      JOIN assignments a
        ON a.congregation_id = te.congregation_id
       AND a.part_key = 'public_talk_speaker'
       AND a.deleted_at IS NULL
       AND a.status <> 'cancelled'
       AND a.week_start_date = te.date - (EXTRACT(ISODOW FROM te.date)::int - 1)
      LEFT JOIN visiting_speakers vs
        ON vs.id = te.visiting_speaker_id AND vs.deleted_at IS NULL
      LEFT JOIN external_congregations ec
        ON ec.id = vs.external_congregation_id AND ec.deleted_at IS NULL
      LEFT JOIN public_talks pt ON pt.id = te.public_talk_id
      WHERE te.direction = 'incoming'
        AND te.deleted_at IS NULL
        AND te.status <> 'did_not_happen'
        AND te.date >= CURRENT_DATE
      ORDER BY a.id, te.date ASC, te.created_at ASC
    `);

    for (const r of rows) {
      const plan = planSlot(r);
      if (!plan) continue;
      await queryRunner.query(
        `UPDATE assignments SET
           publisher_id = $2, speaker_name = $3, speaker_congregation = $4,
           visiting_speaker_id = $5, public_talk_id = $6, part_title = $7,
           special_talk = $8,
           changed_since_publish = CASE WHEN status = 'published' THEN true ELSE changed_since_publish END,
           updated_at = now()
         WHERE id = $1
           AND publisher_id IS NULL
           AND COALESCE(TRIM(speaker_name), '') = ''`,
        [
          r.slot_id,
          plan.publisherId,
          plan.speakerName,
          plan.speakerCongregation,
          plan.visitingSpeakerId,
          plan.publicTalkId,
          plan.partTitle,
          plan.specialTalk,
        ],
      );
    }
  }

  public async down(): Promise<void> {
    // A repair of data: nothing to take back that would not be a loss.
  }
}
