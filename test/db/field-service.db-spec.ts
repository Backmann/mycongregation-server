import { Harness, startHarness } from './harness';
import { FieldServiceMeetingsService } from '../../src/field-service-meetings/field-service-meetings.service';
import { FieldServiceConsistencyService } from '../../src/field-service-meetings/field-service-consistency.service';
import { FieldServicePlannerService } from '../../src/field-service-meetings/field-service-planner.service';

/**
 * Field-service meetings after they were planned (sync audit of 23 October
 * 2026, decided with Lionel on 24 October): a removed group, a conductor who
 * became unavailable, preparing a month again, two preparations at once,
 * the morning check.
 */
describe('field-service meetings after planning (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let k = 1;

  /** A month ahead of today, a fresh one for each test (or the given one). */
  const nextMonth = (ahead?: number): { year: number; month: number } => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (ahead ?? ++k));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  };
  /** The n-th Saturday of the month. */
  const saturday = (y: number, m: number, n: number): string => {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const day = 1 + ((6 - first.getUTCDay() + 7) % 7) + (n - 1) * 7;
    return new Date(Date.UTC(y, m - 1, day)).toISOString().slice(0, 10);
  };
  const mondayOf = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const setTemplate = async (slots: object[]) => {
    const r = await h.as('admin').put('/field-service-template', { slots });
    expect(r.status).toBe(200);
  };
  const prepare = (y: number, m: number, pickConductors = true) =>
    h.as('admin').post('/field-service-template/prepare', {
      year: y,
      month: m,
      pickConductors,
    });
  const preview = async (y: number, m: number) => {
    const r = await h
      .as('admin')
      .post('/field-service-template/preview', { year: y, month: m });
    expect([200, 201]).toContain(r.status);
    return r.body.rows as {
      date: string;
      startTime: string;
      status: string;
      because: string | null;
      existingId?: string | null;
      conductor: { publisherId: string; reason: string } | null;
    }[];
  };
  const meetingsOn = (date: string) =>
    h.sql<{
      id: string;
      start_time: string;
      address: string;
      published: boolean;
    }>(
      `SELECT id, start_time, address, published_at IS NOT NULL AS published
         FROM field_service_meetings
        WHERE week_start_date = $1
          AND week_start_date + (day_of_week - 1) = $2::date
        ORDER BY start_time`,
      [mondayOf(date), date],
    );

  let conductor: string;
  let conductorName: string;

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    conductor = await h.addPublisher({
      firstName: 'Петер',
      lastName: 'Шмидт',
      appointment: 'elder',
      baptismDate: '2000-01-01',
      capabilities: { fs_meeting_conductor: true },
    });
    conductorName = 'Шмидт Петер';
    // The planners: the service overseer, signed in.
    const so = await h.addPublisher({
      firstName: 'Отто',
      lastName: 'Вебер',
      appointment: 'elder',
      baptismDate: '1999-01-01',
    });
    const soUser = await h.addUser({
      login: 'service.overseer',
      role: 'elder',
      publisherId: so,
    });
    const r = await h
      .as('admin')
      .post('/responsibilities', { type: 'service_overseer', userId: soUser });
    expect([200, 201]).toContain(r.status);
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('a removed group', () => {
    it('takes its drafts, keeps its published meetings marked, and its template rows sleep', async () => {
      const { year, month } = nextMonth();
      const g = await h
        .as('admin')
        .post('/service-groups', { name: 'Ален', meetingLocation: 'Ahlen 1' });
      expect(g.status).toBe(201);
      const groupId = g.body.id;
      await setTemplate([
        {
          ordinals: [1, 2],
          dayOfWeek: 6,
          startTime: '10:00',
          serviceGroupId: groupId,
          conductorRule: 'none',
        },
      ]);
      expect((await prepare(year, month)).status).toBe(201);
      // The first Saturday is announced, the second stays a draft.
      const [first] = await meetingsOn(saturday(year, month, 1));
      await h.sql(
        `UPDATE field_service_meetings SET published_at = now() WHERE id = $1`,
        [first.id],
      );

      const impact = await h
        .as('admin')
        .get(`/service-groups/${groupId}/removal-impact`);
      expect(impact.body).toEqual({ slots: 1, drafts: 1, published: 1 });

      expect(
        (await h.as('admin').delete(`/service-groups/${groupId}`)).status,
      ).toBe(204);
      expect(await meetingsOn(saturday(year, month, 2))).toEqual([]);
      expect(await meetingsOn(saturday(year, month, 1))).toHaveLength(1);

      // The month view marks the one left.
      const weekStart = mondayOf(saturday(year, month, 1));
      const list = await h
        .as('admin')
        .get(
          `/field-service-meetings?drafts=1&weekStart=${weekStart}&weekEnd=${mondayOf(saturday(year, month, 3))}`,
        );
      const left = list.body.find((m: { id: string }) => m.id === first.id);
      expect(left.attention).toEqual(['group_removed']);

      // The template still saves with the sleeping row in it…
      const tpl = await h.as('admin').get('/field-service-template');
      await setTemplate(
        tpl.body.map((r: Record<string, unknown>) => ({
          ordinals: r.ordinals,
          lastOnly: r.lastOnly,
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime,
          address: r.address,
          serviceGroupId: r.serviceGroupId,
          isGeneral: r.isGeneral,
          conductorRule: r.conductorRule,
        })),
      );
      // …and preparing skips it, saying why.
      const rows = await preview(year, month);
      expect(rows.map((r) => [r.status, r.because])).toEqual([
        ['group_removed', 'Ален'],
        ['group_removed', 'Ален'],
      ]);
      await setTemplate([]);
    });
  });

  describe('a conductor who became unavailable after the month was prepared', () => {
    it('is marked, and the draft is not announced on its own', async () => {
      // Next month: within the morning check's eight weeks.
      const { year, month } = nextMonth(1);
      await setTemplate([
        {
          ordinals: [1],
          dayOfWeek: 6,
          startTime: '09:30',
          address: 'Зал Царства',
          isGeneral: true,
          conductorRule: 'rotation',
        },
      ]);
      // Only he conducts.
      await h.sql(
        `UPDATE publishers SET capabilities = capabilities - 'fs_meeting_conductor' WHERE id <> $1`,
        [conductor],
      );
      expect((await prepare(year, month)).status).toBe(201);
      const day = saturday(year, month, 1);
      const [draft] = await meetingsOn(day);
      expect(draft).toBeDefined();

      const away = await h.as('admin').post('/absences', {
        publisherId: conductor,
        startDate: day,
        endDate: day,
      });
      expect(away.status).toBe(201);

      const list = await h
        .as('admin')
        .get(
          `/field-service-meetings?drafts=1&weekStart=${mondayOf(day)}&weekEnd=${mondayOf(saturday(year, month, 2))}`,
        );
      expect(
        list.body.find((m: { id: string }) => m.id === draft.id).attention,
      ).toEqual(['conductor_absent']);

      const svc = h.app.get(FieldServiceMeetingsService);
      const res = await svc.publishMonth(tenantId, year, month, { hold: true });
      expect(res.published).toBe(0);
      expect(res.held).toEqual([
        { id: draft.id, date: day, problems: ['conductor_absent'] },
      ]);
      expect((await meetingsOn(day))[0].published).toBe(false);

      // The morning check names him, once.
      const check = h.app.get(FieldServiceConsistencyService);
      const found = await check.runFor(tenantId);
      expect(found).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            meetingId: draft.id,
            kinds: expect.arrayContaining(['conductor_absent']),
            conductor: conductorName,
          }),
        ]),
      );
      const count = async () =>
        (
          await h.sql<{ n: number }>(
            `SELECT count(*)::int AS n FROM notification_outbox WHERE dedupe_key LIKE 'field-service-check:%'`,
          )
        )[0].n;
      const once = await count();
      expect(once).toBeGreaterThan(0);
      await check.runFor(tenantId);
      expect(await count()).toBe(once);

      await h.sql(`DELETE FROM absences WHERE publisher_id = $1`, [conductor]);
      await setTemplate([]);
    });
  });

  describe('preparing a month again', () => {
    it('does not bring back a day removed or moved by hand, nor a second congregation meeting', async () => {
      const { year, month } = nextMonth();
      await setTemplate([
        {
          ordinals: [1, 2, 3],
          dayOfWeek: 6,
          startTime: '10:00',
          address: 'Зал Царства',
          isGeneral: true,
          conductorRule: 'none',
        },
      ]);
      expect((await prepare(year, month)).status).toBe(201);
      const [one] = await meetingsOn(saturday(year, month, 1));
      const [two] = await meetingsOn(saturday(year, month, 2));
      // The first Saturday deleted (the hall is busy)…
      expect(
        (await h.as('admin').delete(`/field-service-meetings/${one.id}`))
          .status,
      ).toBeLessThan(300);
      // …the second moved to Sunday.
      const moved = await h
        .as('admin')
        .patch(`/field-service-meetings/${two.id}`, { dayOfWeek: 7 });
      expect(moved.status).toBe(200);
      // The template changes: 09:30 in the park.
      await setTemplate([
        {
          ordinals: [1, 2, 3],
          dayOfWeek: 6,
          startTime: '09:30',
          address: 'Парк',
          isGeneral: true,
          conductorRule: 'none',
        },
      ]);
      const [three] = await meetingsOn(saturday(year, month, 3));
      const rows = await preview(year, month);
      expect(rows.map((r) => r.status)).toEqual([
        'removed',
        'removed',
        'differs',
      ]);
      expect(rows[2].existingId).toBe(three.id);
      expect(rows[2].because).toBe('10:00 · Зал Царства');

      const again = await prepare(year, month);
      expect(again.body.created).toBe(0);
      expect(await meetingsOn(saturday(year, month, 1))).toEqual([]);
      expect(await meetingsOn(saturday(year, month, 2))).toEqual([]);
      expect(await meetingsOn(saturday(year, month, 3))).toHaveLength(1);
      await setTemplate([]);
    });

    it('two preparations at once make the month once', async () => {
      const { year, month } = nextMonth();
      await setTemplate([
        {
          ordinals: [1, 2],
          dayOfWeek: 6,
          startTime: '10:00',
          address: 'Зал Царства',
          isGeneral: true,
          conductorRule: 'none',
        },
      ]);
      const [a, b] = await Promise.all([
        prepare(year, month),
        prepare(year, month),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.created + b.body.created).toBe(2);
      expect(await meetingsOn(saturday(year, month, 1))).toHaveLength(1);
      expect(await meetingsOn(saturday(year, month, 2))).toHaveLength(1);
      await setTemplate([]);
    });
  });

  describe('who is put first', () => {
    it("a group's overseer without the switch is shown last and not picked", async () => {
      const ov = await h.addPublisher({
        firstName: 'Ханс',
        lastName: 'Мюллер',
        appointment: 'elder',
        baptismDate: '1990-01-01',
      });
      await h.sql(
        `UPDATE publishers SET capabilities = capabilities - 'fs_meeting_conductor' WHERE id = $1`,
        [ov],
      );
      const g = await h
        .as('admin')
        .post('/service-groups', { name: 'Север', overseerPublisherId: ov });
      expect(g.status).toBe(201);
      const { year, month } = nextMonth();
      const day = saturday(year, month, 1);
      const r = await h
        .as('admin')
        .get(
          `/field-service-meetings/suggest-conductor?date=${day}&serviceGroupId=${g.body.id}&conductorRule=group_overseer`,
        );
      expect(r.status).toBe(200);
      expect(r.body[0].publisherId).not.toBe(ov);
      expect(r.body[r.body.length - 1]).toMatchObject({
        publisherId: ov,
        reason: 'not_conductor',
        free: false,
      });
    });
  });

  describe('«Подобрать ведущих»', () => {
    it('follows each slot: a slot without a conductor stays empty, the rest are filled', async () => {
      const { year, month } = nextMonth();
      await h.sql(
        `UPDATE publishers SET capabilities = capabilities || '{"fs_meeting_conductor": true}' WHERE id = $1`,
        [conductor],
      );
      await setTemplate([
        {
          ordinals: [1],
          dayOfWeek: 6,
          startTime: '10:00',
          address: 'Зал Царства',
          isGeneral: true,
          conductorRule: 'none',
        },
        {
          ordinals: [2],
          dayOfWeek: 6,
          startTime: '10:00',
          address: 'Зал Царства',
          isGeneral: true,
          conductorRule: 'rotation',
        },
      ]);
      expect((await prepare(year, month, false)).status).toBe(201);
      const r = await h
        .as('admin')
        .post('/field-service-template/fill-conductors', { year, month });
      expect([200, 201]).toContain(r.status);
      expect(r.body).toMatchObject({ filled: 1, ruleNone: 1, left: [] });
      const who = async (n: number) =>
        (
          await h.sql<{ c: string | null }>(
            `SELECT conductor_publisher_id AS c FROM field_service_meetings WHERE id = $1`,
            [(await meetingsOn(saturday(year, month, n)))[0].id],
          )
        )[0].c;
      expect(await who(1)).toBeNull();
      expect(await who(2)).not.toBeNull();
      await setTemplate([]);
    });
  });

  describe('the calendar', () => {
    it("a circuit overseer's visit beginning on Tuesday the 1st takes the Monday before it", async () => {
      // The next month whose 1st is a Tuesday.
      const d = new Date();
      d.setUTCDate(1);
      do d.setUTCMonth(d.getUTCMonth() + 1);
      while (d.getUTCDay() !== 2);
      const first = d.toISOString().slice(0, 10);
      const monday = new Date(d);
      monday.setUTCDate(0);
      const lastMonday = monday.toISOString().slice(0, 10);
      const ev = await h.as('admin').post('/special-events', {
        title: 'Посещение районного',
        type: 'circuit_overseer_visit',
        date: first,
        endDate: new Date(Date.parse(first) + 5 * 86400000)
          .toISOString()
          .slice(0, 10),
      });
      expect([200, 201]).toContain(ev.status);
      const planner = h.app.get(FieldServicePlannerService);
      expect(await planner.dayTaken(tenantId, lastMonday)).toEqual(
        expect.objectContaining({ kind: 'co_visit' }),
      );
    });
  });

  it('the old generator refuses', async () => {
    const r = await h.as('admin').post('/field-service-template/generate', {
      startYear: 2027,
      startMonth: 1,
      months: 1,
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FS_GENERATE_RETIRED');
  });
});
