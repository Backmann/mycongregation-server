import { Harness, startHarness } from './harness';
import {
  RETENTION_RULES,
  deleteAnnouncementsBefore,
} from '../../src/retention/retention-rules';
import { AuditLog } from '../../src/entities/audit-log.entity';
import { AssignmentRemindersService } from '../../src/assignment-reminders/assignment-reminders.service';

/**
 * ANNOUNCEMENTS (R-01…R-03, 24 November 2026) — who may do what, held whole,
 * and what the database itself holds.
 *
 *  admin — the administrator
 *  bc    — the coordinator of the body of elders
 *  bca   — his assistant
 *  elder — an elder with no responsibility
 *  chair — a ministerial servant who chairs the midweek meeting of the week
 *  pub   — a publisher
 */
type Who = 'admin' | 'bc' | 'bca' | 'elder' | 'chair' | 'pub';
const WHO: Who[] = ['admin', 'bc', 'bca', 'elder', 'chair', 'pub'];
const WRITERS: Who[] = ['admin', 'bc', 'bca'];
const SECRET = 'Совет старейшин сообщает: тайный текст для проверки';

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

describe('announcements (real database)', () => {
  let h: Harness;
  let tenant: string;
  const login = (w: Who) => (w === 'admin' ? 'admin' : `ann${w}user`);
  // Next week: inside the chairman's own fourteen days, and its Wednesday
  // still to come whatever day the test runs on.
  const today = new Date().toISOString().slice(0, 10);
  const WEEK = addDays(monday(today), 7);
  const FAR = '2033-01-03'; // a Monday, far from anything else
  let chairCard: string;

  const row = async (
    act: (as: ReturnType<Harness['as']>, w: Who) => Promise<{ status: number }>,
  ) => {
    const got: Record<string, number> = {};
    for (const w of WHO) got[w] = (await act(h.as(login(w)), w)).status;
    return got;
  };
  const ok = (who: Who[], yes: number, no = 403) =>
    Object.fromEntries(WHO.map((w) => [w, who.includes(w) ? yes : no]));

  const chairPart = async (week: string, kind: string, status: string) => {
    const r = await h.as('admin').post('/assignments', {
      weekStartDate: week,
      eventType: kind,
      partKey: `${kind}_chairman`,
    });
    expect(r.status).toBe(201);
    await h.sql(
      `UPDATE assignments SET publisher_id = $1, status = $2 WHERE id = $3`,
      [chairCard, status, r.body.id],
    );
    return r.body.id as string;
  };
  const write = (week: string, kind = 'midweek', text = 'Объявление') =>
    h.as('admin').post('/announcements', {
      weekStartDate: week,
      eventType: kind,
      text,
    });

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
        lastName: 'Объявления',
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
      return id;
    };
    await person('bc', 'elder', 'body_coordinator');
    await person('bca', 'elder', 'body_coordinator_assistant');
    await person('elder', 'elder');
    chairCard = await person('chair', 'ministerial_servant');
    await person('pub', 'publisher');
    await chairPart(WEEK, 'midweek', 'published');
  });
  afterAll(async () => {
    await h?.close();
  });

  it('writes: the coordinator, his assistant and the admins — nobody else', async () => {
    expect(
      await row((as) =>
        as.post('/announcements', {
          weekStartDate: FAR,
          eventType: 'midweek',
          text: 'Проверка прав',
        }),
      ),
    ).toEqual(ok(WRITERS, 201));
    expect(
      await row((as) => as.get(`/announcements/weeks?from=${FAR}&count=1`)),
    ).toEqual(ok(WRITERS, 200));
    expect(
      Object.fromEntries(
        await Promise.all(
          WHO.map(
            async (w) =>
              [
                w,
                (await h.as(login(w)).get('/announcements/rights')).body.write,
              ] as const,
          ),
        ),
      ),
    ).toEqual(Object.fromEntries(WHO.map((w) => [w, WRITERS.includes(w)])));
  });

  it('reads and ticks: the writers and the chairman of THAT meeting only', async () => {
    const a = await write(WEEK);
    expect(a.status).toBe(201);
    expect(
      await row((as) =>
        as.get(`/announcements/meeting?week=${WEEK}&kind=midweek`),
      ),
    ).toEqual(ok([...WRITERS, 'chair'], 200));
    // Not the weekend of the same week: he does not chair it.
    expect(
      (
        await h
          .as(login('chair'))
          .get(`/announcements/meeting?week=${WEEK}&kind=weekend`)
      ).status,
    ).toBe(403);
    expect(
      await row((as) =>
        as.post(`/announcements/${a.body.id}/read`, { read: true }),
      ),
      // Not 403: an id says nothing to whoever may not read it.
    ).toEqual(ok([...WRITERS, 'chair'], 200, 404));
    // Changing it stays with the writers.
    expect(
      await row((as) =>
        as.patch(`/announcements/${a.body.id}`, { text: 'Изменено' }),
      ),
    ).toEqual(ok(WRITERS, 200));
  });

  it('a chairman whose part is still a draft reads nothing yet', async () => {
    const week = addDays(FAR, 7);
    await chairPart(week, 'midweek', 'draft');
    await write(week);
    const r = await h
      .as(login('chair'))
      .get(`/announcements/meeting?week=${week}&kind=midweek`);
    expect(r.status).toBe(403);
    // The writers see who it will be, and that he does not know yet.
    const w = await h
      .as(login('bc'))
      .get(`/announcements/weeks?from=${week}&count=1`);
    const mid = w.body.weeks[0].meetings.find(
      (m: { kind: string }) => m.kind === 'midweek',
    );
    expect(mid.chairman).toMatchObject({
      firstName: 'chair',
      published: false,
    });
    expect(mid.date).toBe(addDays(week, 2)); // Wednesday
  });

  it('the text lies encrypted in the database, and the journal keeps no words', async () => {
    const a = await write(FAR, 'weekend', SECRET);
    expect(a.status).toBe(201);
    const [stored] = await h.sql<{ text: string }>(
      `SELECT text FROM meeting_announcements WHERE id = $1`,
      [a.body.id],
    );
    expect(stored.text.startsWith('enc:v1:')).toBe(true);
    expect(stored.text).not.toContain('тайный');
    // The journal's own columns are encrypted too, so it is read through the
    // entity (decrypted) — a raw SELECT would show ciphertext and prove
    // nothing.
    const journal = await h.db
      .getRepository(AuditLog)
      .find({ where: { entityId: a.body.id } });
    expect(journal.length).toBeGreaterThan(0);
    for (const j of journal) {
      expect(JSON.stringify(j)).not.toContain('тайный');
    }
    // And it comes back whole to those who may read it.
    const m = await h
      .as(login('bca'))
      .get(`/announcements/meeting?week=${FAR}&kind=weekend`);
    expect(m.body.items.map((i: { text: string }) => i.text)).toContain(SECRET);
  });

  it('the chairman finds his own coming meeting; anyone else finds nothing', async () => {
    const mine = await h.as(login('chair')).get('/announcements/mine');
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({
      weekStartDate: WEEK,
      kind: 'midweek',
      date: addDays(WEEK, 2),
    });
    expect(mine.body[0].items.length).toBeGreaterThan(0);
    expect((await h.as(login('pub')).get('/announcements/mine')).body).toEqual(
      [],
    );
  });

  it('a suggestion is taken once; the order names every one', async () => {
    const week = addDays(FAR, 14);
    const body = {
      weekStartDate: week,
      eventType: 'midweek',
      text: 'Отчёт о счетах',
      source: 'template',
      sourceKey: 'accounts_month:2033-01',
    };
    expect((await h.as('admin').post('/announcements', body)).status).toBe(201);
    expect((await h.as(login('bc')).post('/announcements', body)).status).toBe(
      409,
    );
    const b = await write(week, 'midweek', 'Второе');
    const list = await h
      .as('admin')
      .get(`/announcements/meeting?week=${week}&kind=midweek`);
    const ids = list.body.items.map((i: { id: string }) => i.id);
    expect(ids).toHaveLength(2);
    const reordered = await h.as('admin').post('/announcements/order', {
      weekStartDate: week,
      eventType: 'midweek',
      ids: [...ids].reverse(),
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body[0].id).toBe(b.body.id);
    // Leaving one out is refused.
    expect(
      (
        await h.as('admin').post('/announcements/order', {
          weekStartDate: week,
          eventType: 'midweek',
          ids: [ids[0]],
        })
      ).status,
    ).toBe(400);
    // Not a Monday: refused.
    expect((await write(addDays(week, 1))).status).toBe(400);
  });

  it('moved on unread: keeps the day it was meant for and starts unread', async () => {
    const from = addDays(FAR, 21);
    const to = addDays(FAR, 28);
    const a = await write(from);
    await h
      .as('admin')
      .post(`/announcements/${a.body.id}/read`, { read: true });
    const c = await h
      .as(login('bc'))
      .post(`/announcements/${a.body.id}/carry`, {
        weekStartDate: to,
        eventType: 'weekend',
      });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({
      read: false,
      carriedFrom: addDays(from, 2),
    });
    const m = await h
      .as('admin')
      .get(`/announcements/meeting?week=${to}&kind=weekend`);
    expect(m.body.items.map((i: { id: string }) => i.id)).toContain(a.body.id);
  });

  it('an assembly entered afterwards: the week holds no meeting, the announcement is kept and shown', async () => {
    const week = addDays(FAR, 35);
    await write(week);
    const ev = await h.as('admin').post('/special-events', {
      title: 'Районный конгресс',
      type: 'circuit_assembly',
      date: addDays(week, 6),
    });
    expect([200, 201]).toContain(ev.status);
    const w = await h
      .as('admin')
      .get(`/announcements/weeks?from=${week}&count=1`);
    expect(w.body.weeks[0].meetingsHeld).toBe(false);
    expect(w.body.weeks[0].meetings).toEqual([]);
    expect(w.body.weeks[0].unplaced).toHaveLength(1);
  });

  it('gone 30 days after its week, and not a day before', async () => {
    const rule = RETENTION_RULES.find((r) => r.key === 'announcements');
    if (!rule || rule.kind !== 'counted') {
      throw new Error('announcements rule missing');
    }
    // Weeks long gone cannot be written through the app; put in directly.
    const put = async (week: string) =>
      (
        await h.sql<{ id: string }>(
          `INSERT INTO meeting_announcements (congregation_id, week_start_date, event_type, text)
           VALUES ($1, $2, 'midweek', 'старое') RETURNING id`,
          [tenant, week],
        )
      )[0].id;
    const old = await put('2020-01-06');
    const kept = await put('2020-02-03');
    // Seen from 2020-03-08: Sunday 2020-02-09 is 28 days back — kept; the
    // week of 2020-01-06 ended 2020-01-12 — gone.
    const before = rule.keptFrom('2020-03-08');
    expect(await rule.count(h.db, tenant, before)).toBe(1);
    // Counting only until switched on (retention.service.ts).
    expect(rule.apply).toBeUndefined();
    expect(await deleteAnnouncementsBefore(h.db, tenant, before)).toBe(1);
    const left = await h.sql<{ id: string }>(
      `SELECT id FROM meeting_announcements WHERE id = ANY($1)`,
      [[old, kept]],
    );
    expect(left.map((r) => r.id)).toEqual([kept]);
  });

  it('the rest of the writers\u2019 routes: nobody else', async () => {
    const week = addDays(FAR, 42);
    const mk = async () => (await write(week)).body.id as string;
    const ids = Object.fromEntries(
      await Promise.all(WHO.map(async (w) => [w, await mk()] as const)),
    );
    expect(
      await row((as, w) =>
        as.post(`/announcements/${ids[w]}/carry`, {
          weekStartDate: WEEK,
          eventType: 'midweek',
        }),
      ),
    ).toEqual(ok(WRITERS, 200));
    // «Убрать» is for one left unread at a meeting already held.
    await h.sql(
      `UPDATE meeting_announcements SET week_start_date = $2 WHERE id = ANY($1)`,
      [Object.values(ids), addDays(monday(today), -7)],
    );
    expect(
      await row((as, w) => as.post(`/announcements/${ids[w]}/dismiss`)),
    ).toEqual(ok(WRITERS, 204));
    expect(await row((as, w) => as.delete(`/announcements/${ids[w]}`))).toEqual(
      ok(WRITERS, 204),
    );
    const all = (
      await h
        .as('admin')
        .get(`/announcements/meeting?week=${week}&kind=midweek`)
    ).body.items.map((i: { id: string }) => i.id) as string[];
    expect(
      await row((as) =>
        as.post('/announcements/order', {
          weekStartDate: week,
          eventType: 'midweek',
          ids: all,
        }),
      ),
    ).toEqual(ok(WRITERS, 200));
  });

  it('ticking one is not for anyone else, and does not tell whether it exists', async () => {
    const a = await write(addDays(FAR, 49));
    const r = await h
      .as(login('pub'))
      .post(`/announcements/${a.body.id}/read`, {
        read: true,
      });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('ANNOUNCEMENT_NOT_FOUND');
  });

  it('another congregation\u2019s announcement is not there for anybody here', async () => {
    const [other] = await h.sql<{ id: string }>(
      `INSERT INTO congregations (name, country, language, timezone) SELECT 'Другое собрание', country, language, timezone FROM congregations LIMIT 1 RETURNING id`,
    );
    const [foreign] = await h.sql<{ id: string }>(
      `INSERT INTO meeting_announcements (congregation_id, week_start_date, event_type, text)
       VALUES ($1, $2, 'midweek', 'чужое') RETURNING id`,
      [other.id, FAR],
    );
    const as = h.as('admin');
    expect(
      (await as.patch(`/announcements/${foreign.id}`, { text: 'x' })).status,
    ).toBe(404);
    expect(
      (await as.post(`/announcements/${foreign.id}/read`, { read: true }))
        .status,
    ).toBe(404);
    expect((await as.delete(`/announcements/${foreign.id}`)).status).toBe(404);
    const w = await as.get(`/announcements/weeks?from=${FAR}&count=1`);
    expect(JSON.stringify(w.body)).not.toContain(foreign.id);
  });

  it('a day that does not exist, or a meeting already past, is refused plainly', async () => {
    expect(
      (await h.as('admin').get('/announcements/weeks?from=2026-13-01')).status,
    ).toBe(400);
    expect((await write('2026-13-01')).status).toBe(400);
    const a = await write(FAR);
    const past = await h.as('admin').post(`/announcements/${a.body.id}/carry`, {
      weekStartDate: '2026-01-05',
      eventType: 'midweek',
    });
    expect(past.status).toBe(400);
    expect(past.body.code).toBe('ANNOUNCEMENT_MEETING_NOT_AHEAD');
    // A week whose time is over is not written to.
    const gone = await write('2020-01-06');
    expect(gone.status).toBe(400);
    expect(gone.body.code).toBe('ANNOUNCEMENT_WEEK_GONE');
  });

  it('the evening before, the chairman’s reminder says how many he reads (R-09 step 5)', async () => {
    const [{ id: uid }] = await h.sql<{ id: string }>(
      `SELECT user_id AS id FROM publishers WHERE id = $1`,
      [chairCard],
    );
    // A clean count: what earlier tests left that week is read already.
    await h.sql(
      `UPDATE meeting_announcements SET read_at = now() WHERE congregation_id = $1 AND week_start_date = $2`,
      [tenant, WEEK],
    );
    const ids: string[] = [];
    for (const text of ['Ждёт', 'Прочитано', 'Отпущено', 'В выходные']) {
      const r = await write(
        WEEK,
        text === 'В выходные' ? 'weekend' : 'midweek',
        text,
      );
      expect(r.status).toBe(201);
      ids.push(r.body.id);
    }
    await h.sql(
      `UPDATE meeting_announcements SET read_at = now() WHERE id = $1`,
      [ids[1]],
    );
    // «Убрать» is refused for a meeting still to come…
    const early = await h
      .as(login('bc'))
      .post(`/announcements/${ids[2]}/dismiss`);
    expect(early.status).toBe(400);
    expect(early.body.code).toBe('ANNOUNCEMENT_MEETING_NOT_HELD');
    // …so a let-go one is set straight in the database, to test the count.
    await h.sql(
      `UPDATE meeting_announcements SET dismissed_at = now() WHERE id = $1`,
      [ids[2]],
    );
    await h.app
      .get(AssignmentRemindersService)
      .sendDigests(tenant, addDays(WEEK, 1));
    const bodies = (
      await h.sql<{ body: string }>(
        `SELECT body FROM notification_outbox WHERE kind = 'assignment_reminder' AND user_id = $1`,
        [uid],
      )
    )
      .map((r) => r.body)
      .join('\n');
    // One waiting at his midweek meeting; the weekend one is not his.
    expect(bodies).toContain('(объявлений: 1)');
    // The number, never the words.
    expect(bodies).not.toContain('Ждёт');
  });
});
