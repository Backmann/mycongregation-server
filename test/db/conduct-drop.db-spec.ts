import { Harness, startHarness } from './harness';

/**
 * «Это была проба — стереть» (Lionel, 25 October 2026): a run tried out on
 * the meeting's own day left a result nothing could remove. The chairman,
 * the timekeeper or an admin may wipe the result and the run until the day
 * is over; after it, the result is the meeting's.
 */
describe('a trial run of the meeting, wiped (real database)', () => {
  let h: Harness;
  let tenantId: string;

  const monday = (offsetWeeks: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * offsetWeeks);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const save = (week: string) =>
    h.as('admin').put('/conduct-runs', {
      weekStartDate: week,
      eventType: 'weekend',
      segments: [
        {
          key: 'public_talk_speaker',
          publisherIds: [],
          plannedSec: 1800,
          actualSec: 60,
        },
      ],
      totalSec: 191,
      plannedSec: 6300,
    });
  const live = async (week: string) => {
    const [{ id: user }] = await h.sql<{ id: string }>(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
    );
    await h.sql(
      `INSERT INTO conduct_live (congregation_id, week_start_date, event_type, state, controller_user_id, controller_seen_at)
       VALUES ($1, $2, 'weekend', '{"v":1,"index":3}', $3, now())`,
      [tenantId, week, user],
    );
  };
  const left = async (week: string) =>
    (
      await h.sql<{ runs: number; lives: number }>(
        `SELECT (SELECT count(*)::int FROM conduct_runs WHERE week_start_date = $1 AND event_type = 'weekend') AS runs,
                (SELECT count(*)::int FROM conduct_live WHERE week_start_date = $1 AND event_type = 'weekend') AS lives`,
        [week],
      )
    )[0];

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('before the meeting is over: the result and the run go, and the meeting can run again', async () => {
    const week = monday(2);
    expect((await save(week)).status).toBe(200);
    await live(week);
    const r = await h
      .as('admin')
      .delete(`/conduct-runs?week=${week}&kind=weekend`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ result: true, run: true });
    expect(await left(week)).toEqual({ runs: 0, lives: 0 });
    expect((await save(week)).status).toBe(200);
  });

  it('after the meeting’s day the result stays', async () => {
    const week = monday(-3);
    await h.sql(
      `INSERT INTO conduct_runs (congregation_id, week_start_date, event_type, segments, total_sec, planned_sec, saved_at)
       VALUES ($1, $2, 'weekend', '[]', 6200, 6300, now())`,
      [tenantId, week],
    );
    const r = await h
      .as('admin')
      .delete(`/conduct-runs?week=${week}&kind=weekend`);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONDUCT_RESULT_KEPT');
    expect((await left(week)).runs).toBe(1);
  });

  it('nobody else wipes it', async () => {
    const week = monday(3);
    expect((await save(week)).status).toBe(200);
    await h.addUser({ login: 'plain', role: 'publisher' });
    const r = await h
      .as('plain')
      .delete(`/conduct-runs?week=${week}&kind=weekend`);
    expect(r.status).toBe(403);
    expect((await left(week)).runs).toBe(1);
  });
});
