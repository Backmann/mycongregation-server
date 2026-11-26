import { Harness, startHarness } from './harness';
import { deleteAnnouncementsBefore } from '../../src/retention/retention-rules';

/**
 * SUGGESTED ANNOUNCEMENTS (announcements R-09, 26 November 2026) on a real
 * database: who sees them, «add» once, «not needed» for everyone, and the
 * stale mark when the event changes.
 */
type Who = 'admin' | 'bc' | 'bca' | 'elder' | 'pub';
const WHO: Who[] = ['admin', 'bc', 'bca', 'elder', 'pub'];
const WRITERS: Who[] = ['admin', 'bc', 'bca'];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDays(iso, 1 - dow);
}

describe('announcement suggestions (real database)', () => {
  let h: Harness;
  let tenant: string;
  const login = (w: Who) => (w === 'admin' ? 'admin' : `sug${w}user`);
  const today = new Date().toISOString().slice(0, 10);
  // Next week: its Wednesday is still ahead whatever day the test runs.
  const WEEK = addDays(monday(today), 7);
  const LATER = addDays(WEEK, 14);
  let cleaningId: string;
  let laterId: string;

  const suggestions = (w: Who, week: string) =>
    h.as(login(w)).get(`/announcements/suggestions?week=${week}`);
  const keysOf = (body: { items: { key: string }[] }) =>
    body.items.map((s) => s.key);

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const settings = await h.as('admin').post('/meeting-settings', {
      effectiveFrom: '2026-01-05',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '10:00',
      address: 'Musterstraße 1, 59065 Hamm',
      confirmPast: true,
    });
    expect([200, 201]).toContain(settings.status);
    const person = async (w: Who, role: string, resp?: string) => {
      const id = await h.addPublisher({
        firstName: w,
        lastName: 'Подсказки',
        appointment: role === 'publisher' ? 'publisher' : role,
        baptismDate: '2000-01-01',
      });
      const uid = await h.addUser({
        login: login(w),
        role: role as 'elder',
        publisherId: id,
      });
      if (resp)
        await h.sql(
          `INSERT INTO responsibilities (congregation_id, type, user_id) VALUES ($1, $2, $3)`,
          [tenant, resp, uid],
        );
    };
    await person('bc', 'elder', 'body_coordinator');
    await person('bca', 'elder', 'body_coordinator_assistant');
    await person('elder', 'elder');
    await person('pub', 'publisher');

    // A general cleaning on the Saturday of next week, and one two weeks on.
    const make = async (date: string) => {
      const r = await h.as('admin').post('/special-events', {
        type: 'general_cleaning',
        title: 'Генеральная уборка',
        date,
        time: '09:00',
      });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    cleaningId = await make(addDays(WEEK, 5));
    laterId = await make(addDays(LATER, 5));
  });
  afterAll(async () => {
    await h?.close();
  });

  it('only the writers see them — not even a count for anyone else', async () => {
    const got: Record<string, number> = {};
    const sum: Record<string, number> = {};
    for (const w of WHO) {
      got[w] = (await suggestions(w, WEEK)).status;
      sum[w] = (
        await h.as(login(w)).get('/announcements/suggestions/summary')
      ).status;
    }
    const want = Object.fromEntries(
      WHO.map((w) => [w, WRITERS.includes(w) ? 200 : 403]),
    );
    expect(got).toEqual(want);
    expect(sum).toEqual(want);
  });

  it('offers the cleaning for the meeting before it, with its words', async () => {
    const r = await suggestions('bc', WEEK);
    const s = r.body.items.find(
      (x: { key: string }) => x.key === `general_cleaning:${cleaningId}`,
    );
    expect(s).toBeDefined();
    expect(s.meetings).toEqual([{ kind: 'midweek', date: addDays(WEEK, 2) }]);
    expect(s.text).toMatch(/^Суббота, .*, 9:00 — генеральная уборка/);
    // The later one is «further on», not offered for this week.
    expect(r.body.upcoming).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: `general_cleaning:${laterId}`,
          weekStartDate: LATER,
        }),
      ]),
    );
  });

  it('refuses a meeting it may not go to', async () => {
    const r = await h.as(login('bc')).post('/announcements/suggestions/take', {
      weekStartDate: WEEK,
      key: `general_cleaning:${cleaningId}`,
      kinds: ['weekend'], // Sunday comes after the Saturday cleaning
      text: 'Текст',
    });
    expect(r.status).toBe(400);
  });

  it("«add» writes one announcement, keeps the writer's words, and is taken once", async () => {
    const take = () =>
      h.as(login('bc')).post('/announcements/suggestions/take', {
        weekStartDate: WEEK,
        key: `general_cleaning:${cleaningId}`,
        kinds: ['midweek'],
        text: 'Уборка в субботу — свои слова координатора',
      });
    const r = await take();
    expect(r.status).toBe(201);
    expect(r.body).toHaveLength(1);
    expect(r.body[0].source).toBe('general_cleaning');
    const rows = await h.sql<{ source_key: string; source_facts: string }>(
      `SELECT source_key, source_facts FROM meeting_announcements WHERE congregation_id = $1 AND week_start_date = $2`,
      [tenant, WEEK],
    );
    expect(rows).toEqual([
      {
        source_key: `general_cleaning:${cleaningId}.midweek`,
        source_facts: expect.stringMatching(/^[0-9a-f]{16}$/),
      },
    ]);
    // Gone from the offer — for the assistant as well.
    expect(keysOf((await suggestions('bca', WEEK)).body)).not.toContain(
      `general_cleaning:${cleaningId}`,
    );
    expect((await take()).status).toBe(409);
  });

  it('marks the taken text stale when the event changes, and refreshes it', async () => {
    expect((await suggestions('bc', WEEK)).body.stale).toEqual([]);
    const patch = await h
      .as('admin')
      .patch(`/special-events/${cleaningId}`, { time: '08:30' });
    expect(patch.status).toBe(200);
    const after = await suggestions('bc', WEEK);
    expect(after.body.stale).toHaveLength(1);
    expect(after.body.stale[0].reason).toBe('changed');
    const summary = await h
      .as(login('bc'))
      .get('/announcements/suggestions/summary');
    expect(summary.body.stale).toBe(1);

    const fresh = await h
      .as(login('bc'))
      .post('/announcements/suggestions/refresh', {
        announcementId: after.body.stale[0].announcementId,
      });
    expect(fresh.status).toBe(200);
    expect(fresh.body.text).toContain('8:30');
    expect((await suggestions('bc', WEEK)).body.stale).toEqual([]);
  });

  it('«not needed» is for every writer, and the route is not taken for an announcement id', async () => {
    const key = `general_cleaning:${laterId}`;
    expect(keysOf((await suggestions('bca', LATER)).body)).toContain(key);
    const r = await h
      .as(login('bc'))
      .post('/announcements/suggestions/not-needed', { key });
    expect(r.status).toBe(204);
    expect(keysOf((await suggestions('bca', LATER)).body)).not.toContain(key);
    expect(
      (
        await h
          .as(login('pub'))
          .post('/announcements/suggestions/not-needed', { key })
      ).status,
    ).toBe(403);
    const rows = await h.sql<{ source_key: string; week_start_date: string }>(
      `SELECT source_key, to_char(week_start_date, 'YYYY-MM-DD') AS week_start_date FROM announcement_dismissals WHERE congregation_id = $1`,
      [tenant],
    );
    expect(rows).toEqual([{ source_key: key, week_start_date: LATER }]);
  });

  it('a dismissal leaves with its week (retention «announcements»)', async () => {
    await deleteAnnouncementsBefore(h.db, tenant, addDays(LATER, 7));
    const left = await h.sql(
      `SELECT 1 FROM announcement_dismissals WHERE congregation_id = $1`,
      [tenant],
    );
    expect(left).toEqual([]);
  });
});
