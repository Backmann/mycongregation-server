import { ConductRunsService } from '../../src/conduct-runs/conduct-runs.service';
import { MeetingDayService } from '../../src/conduct-runs/meeting-day.service';
import { EventType } from '../../src/common/enums/event-type.enum';
import { addDaysISO } from '../../src/common/week-rules';
import { Harness, startHarness } from './harness';

/**
 * How long the result of a meeting is kept (Lionel, 28 October 2026):
 * through the 4th calendar day after the meeting day, deleted the night
 * after — a Wednesday meeting until Sunday, a Sunday one until Thursday.
 * The meeting day is read from the week rules, not assumed.
 */
describe('the result of a meeting, kept through the 4th day (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let service: ConductRunsService;

  const monday = (offsetWeeks: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * offsetWeeks);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const insert = async (week: string, kind: string) =>
    (
      await h.sql<{ id: string }>(
        `INSERT INTO conduct_runs (congregation_id, week_start_date, event_type, segments, total_sec, planned_sec, saved_at)
         VALUES ($1, $2, $3, '[]', 6200, 6300, $2::date + interval '2 days 20 hours') RETURNING id`,
        [tenantId, week, kind],
      )
    )[0].id;
  const exists = async (id: string) =>
    (await h.sql(`SELECT 1 FROM conduct_runs WHERE id = $1`, [id])).length ===
    1;

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    // Wednesday and Sunday, as most congregations meet.
    await h.sql(
      `INSERT INTO meeting_settings (congregation_id, effective_from, midweek_dow, midweek_time, weekend_dow, weekend_time, address, microphone_slots)
       VALUES ($1, '2020-01-01', 3, '19:00', 7, '10:00', 'Saal', 2)`,
      [tenantId],
    );
    service = h.app.get(ConductRunsService);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('is kept on the 4th day after the meeting and deleted on the 5th, for both meetings', async () => {
    const week = monday(-3);
    const days = h.app.get(MeetingDayService);
    for (const kind of [EventType.MIDWEEK, EventType.WEEKEND] as const) {
      const id = await insert(week, kind);
      const meeting = await days.meetingDate(tenantId, week, kind);
      expect(meeting).not.toBeNull();
      const keepUntil = await service.keepUntil({
        congregationId: tenantId,
        weekStartDate: week,
        eventType: kind,
        savedAt: new Date(),
      });
      expect(keepUntil).toBe(addDaysISO(meeting!, 4));
      // Wednesday → Sunday, Sunday → Thursday.
      expect(new Date(`${keepUntil}T12:00:00Z`).getUTCDay()).toBe(
        kind === EventType.MIDWEEK ? 0 : 4,
      );
      // Noon on the last day, then noon the day after (UTC; noon is the
      // same date in any of Europe's zones).
      const last = new Date(`${keepUntil}T12:00:00Z`);
      await service.deleteExpired(last);
      expect(await exists(id)).toBe(true);
      await service.deleteExpired(new Date(last.getTime() + 24 * 3600e3));
      expect(await exists(id)).toBe(false);
    }
  });
});
