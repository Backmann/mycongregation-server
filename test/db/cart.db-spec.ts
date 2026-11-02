import { Harness, startHarness } from './harness';
import { AuditLog } from '../../src/entities/audit-log.entity';
import { AssignmentRemindersService } from '../../src/assignment-reminders/assignment-reminders.service';
import { CartRemindersService } from '../../src/cart-weeks/cart-reminders.service';
import {
  NotificationsService,
  categoryOfKind,
} from '../../src/notifications/notifications.service';

/**
 * The stand as it is really served, against a real database (2 November
 * 2026): a place on a date with its hours; people sign up for a span of it
 * and are put on the plan for a span, an hour or more on the half-hour.
 * Every rule agreed with Lionel that day is held here, and each was checked
 * the other way round — the rule switched off, its test failing.
 */
describe('public witnessing — the stand (real database)', () => {
  let h: Harness;
  let tenant = '';
  const pid: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const sent: {
    kind: string;
    userIds: string[];
    urgent?: boolean;
    emailFallback?: boolean;
  }[] = [];

  const mondayIn = (weeks: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * weeks);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const code = (res: { status: number; body: { code?: string } }) => [
    res.status,
    res.body.code,
  ];
  const outbox = (kind: string) =>
    h.sql<{ user_id: string; body: string; title: string }>(
      `SELECT user_id, body, title FROM notification_outbox WHERE kind = $1 ORDER BY created_at`,
      [kind],
    );
  const toldTo = async (kind: string) =>
    new Set((await outbox(kind)).map((r) => r.user_id));

  let locA = '';
  let locB = '';

  type DayView = {
    id: string;
    date: string;
    locationId: string;
    myRequests: { id: string }[];
    mine: { id: string; startTime: string; endTime: string }[];
    wishes?: {
      publisherId: string;
      withWhomNote?: string | null;
      late?: boolean;
    }[];
    plan?: {
      id: string;
      publisherId: string | null;
      startTime: string;
      endTime: string;
    }[];
    cancellations: { id: string; reason: string | null }[];
  };
  const view = async (who: string, week: string) => {
    const res = await h.as(who).get(`/cart-weeks?weekStart=${week}`);
    expect(res.status).toBe(200);
    return res.body as { id: string; status: string; days: DayView[] };
  };
  const build = async (
    week: string,
    days: number[],
    locs: string[],
    from = '09:00',
    to = '16:00',
  ) => {
    const res = await h.as('boss').post('/cart-weeks', {
      weekStartDate: week,
      startTime: from,
      endTime: to,
      daysOfWeek: days,
      locationIds: locs,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  // A week gone by, for the rules about what is over (2 November 2026: a
  // day already over is no longer planned through the API). Built far
  // ahead, then moved back in the database — as the stand's seed does.
  let farAhead = 70;
  const buildPast = async (
    week: string,
    days: number[],
    locs: string[],
    from = '09:00',
    to = '16:00',
  ) => {
    const tmp = mondayIn(farAhead++);
    const id = await build(tmp, days, locs, from, to);
    const shift = Math.round(
      (Date.parse(`${tmp}T00:00:00Z`) - Date.parse(`${week}T00:00:00Z`)) /
        86400000,
    );
    await h.sql(
      `UPDATE cart_days SET date = date - $2::int WHERE week_id = $1`,
      [id, shift],
    );
    await h.sql(`UPDATE cart_weeks SET week_start_date = $2 WHERE id = $1`, [
      id,
      week,
    ]);
    return id;
  };
  const dayOf = async (week: string, date: string, loc: string) =>
    (await view('boss', week)).days.find(
      (d) => d.date === date && d.locationId === loc,
    )!.id;
  const ask = (who: string, day: string, a: string, b: string, note?: string) =>
    h.as(who).post(`/cart/days/${day}/requests`, {
      startTime: a,
      endTime: b,
      ...(note ? { withWhomNote: note } : {}),
    });
  const put = (day: string, who: string, a: string, b: string) =>
    h.as('boss').post(`/cart/days/${day}/assignments`, {
      publisherId: pid[who],
      startTime: a,
      endTime: b,
    });

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    // What reaches the gateway, with its urgency and its letter.
    const gw = h.app.get(NotificationsService);
    const real = gw.notify.bind(gw);
    jest.spyOn(gw, 'notify').mockImplementation(async (input) => {
      sent.push({
        kind: input.kind,
        userIds: input.userIds,
        urgent: input.urgent,
        emailFallback: input.emailFallback,
      });
      return real(input);
    });
    const card = async (
      login: string,
      gender: 'brother' | 'sister',
      appointment: string,
      approved: boolean,
      extra: Record<string, unknown> = {},
    ) => {
      pid[login] = await h.addPublisher({
        firstName: login,
        lastName: 'Тест',
        gender,
        appointment,
        ...(appointment === 'publisher' || appointment === 'elder'
          ? { baptismDate: '1990-01-01' }
          : {}),
        ...extra,
      });
      await h.sql(
        `UPDATE publishers SET status = 'active', status_manually_overridden = true,
                capabilities = $2::jsonb WHERE id = $1`,
        [pid[login], JSON.stringify({ public_witnessing: approved })],
      );
      uid[login] = await h.addUser({
        login,
        role: appointment === 'elder' ? 'elder' : 'publisher',
        publisherId: pid[login],
      });
    };
    await card('boss', 'brother', 'elder', true);
    for (const [n, g] of [
      ['anna', 'sister'],
      ['boris', 'brother'],
      ['clara', 'sister'],
      ['dan', 'brother'],
      ['eva', 'sister'],
      ['fedor', 'brother'],
      ['gleb', 'brother'],
    ] as const) {
      await card(n, g, 'publisher', true);
    }
    await card('pio', 'sister', 'publisher', true, {
      pioneerType: 'regular',
      pioneerSince: '2020-01-01',
    });
    await card('nocard', 'brother', 'publisher', false);
    await card('novice', 'brother', 'unbaptized_publisher', true);
    await card('away', 'brother', 'publisher', true);
    await h.sql(`UPDATE publishers SET status = 'inactive' WHERE id = $1`, [
      pid.away,
    ]);
    const r = await h.as('admin').post('/responsibilities', {
      type: 'public_witnessing',
      userId: uid.boss,
    });
    expect(r.status).toBe(201);
    const a = await h.as('boss').post('/cart-locations', {
      name: 'Bahnhof',
      kind: 'stand',
      equipmentAt: 'Зал Царства в Ahlen',
    });
    locA = a.body.id;
    // A second place takes the same storage without being told.
    const b = await h.as('boss').post('/cart-locations', { name: 'Markt' });
    locB = b.body.id;
    expect(b.body.equipmentAt).toBe('Зал Царства в Ahlen');
  });
  afterAll(async () => {
    await h?.close();
  });

  it('a week starts on a Monday; a bad date or number is a refusal, not a 500', async () => {
    const res = await h.as('boss').post('/cart-weeks', {
      weekStartDate: addDays(mondayIn(5), 1),
      startTime: '10:00',
      endTime: '12:00',
      daysOfWeek: [1],
      locationIds: [locA],
    });
    expect(code(res)).toEqual([400, 'WEEK_NOT_MONDAY']);
    expect(code(await h.as('anna').get('/cart-weeks?weekStart=abc'))).toEqual([
      400,
      'WEEK_NOT_MONDAY',
    ]);
    expect(
      (await h.as('boss').get('/cart-weeks/pairings?weeks=abc')).status,
    ).toBe(200);
  });

  describe('a week from sketch to plan', () => {
    const week = mondayIn(3);
    const tue = addDays(week, 1);
    const thu = addDays(week, 3);
    let weekId = '';
    let tueA = '';
    let tueB = '';
    let thuA = '';

    beforeAll(async () => {
      weekId = await build(week, [2, 4], [locA]);
      await build(week, [2], [locB]);
      tueA = await dayOf(week, tue, locA);
      tueB = await dayOf(week, tue, locB);
      thuA = await dayOf(week, thu, locA);
    });

    it('a draft shows the others nothing of what is in it', async () => {
      const v = await view('anna', week);
      expect(v.status).toBe('draft');
      expect(v.days).toEqual([]);
    });

    it('opening it tells everyone approved and baptized — and nobody else', async () => {
      const res = await h
        .as('boss')
        .post(`/cart-weeks/${weekId}/open`, { signupUntil: addDays(week, -3) });
      expect(res.status).toBe(201);
      const told = await toldTo('cart_open');
      for (const who of ['anna', 'boris', 'pio', 'boss'])
        expect([who, told.has(uid[who])]).toEqual([who, true]);
      for (const who of ['nocard', 'novice', 'away'])
        expect([who, told.has(uid[who])]).toEqual([who, false]);
    });

    it('only the approved and baptized sign up or are put on', async () => {
      expect(code(await ask('nocard', tueA, '10:00', '12:00'))).toEqual([
        403,
        'CART_NOT_ELIGIBLE',
      ]);
      expect(code(await ask('novice', tueA, '10:00', '12:00'))).toEqual([
        403,
        'CART_NOT_ELIGIBLE',
      ]);
      expect(code(await put(tueA, 'nocard', '10:00', '12:00'))).toEqual([
        400,
        'CART_NOT_APPROVED',
      ]);
      expect(code(await put(tueA, 'novice', '10:00', '12:00'))).toEqual([
        400,
        'CART_NOT_BAPTIZED',
      ]);
    });

    it('a time is an hour or more, on the half-hour, inside the day', async () => {
      expect(code(await ask('anna', tueA, '10:00', '10:30'))).toEqual([
        400,
        'CART_BAD_SPAN',
      ]);
      expect(code(await ask('anna', tueA, '08:00', '10:00'))).toEqual([
        400,
        'CART_BAD_SPAN',
      ]);
      expect((await ask('anna', tueA, '10:15', '11:30')).status).toBe(400);
    });

    it('each says when he can — once in the morning and again after lunch', async () => {
      expect(
        (await ask('anna', tueA, '09:00', '11:00', 'с Борисом')).status,
      ).toBe(201);
      expect((await ask('anna', tueA, '13:00', '15:00')).status).toBe(201);
      expect(code(await ask('anna', tueA, '10:00', '12:00'))).toEqual([
        400,
        'CART_ALREADY_REQUESTED',
      ]);
      expect((await ask('boris', tueA, '09:00', '12:00')).status).toBe(201);
      expect((await ask('clara', tueA, '10:00', '11:30')).status).toBe(201);
    });

    it('while sign-up is open everyone sees who marked which time — but not the «с кем»', async () => {
      const d = (await view('clara', week)).days.find((x) => x.id === tueA)!;
      const wishes = d.wishes!.filter((w) => w.publisherId === pid.anna);
      expect(wishes).toHaveLength(2);
      expect(wishes.every((w) => w.withWhomNote === undefined)).toBe(true);
      const boss = (await view('boss', week)).days.find((x) => x.id === tueA)!;
      expect(boss.wishes!.some((w) => w.withWhomNote === 'с Борисом')).toBe(
        true,
      );
    });

    it('nobody stands in two places at one time; the next hours elsewhere are fine', async () => {
      expect((await put(tueA, 'anna', '09:00', '11:00')).status).toBe(201);
      expect(code(await put(tueB, 'anna', '10:30', '12:00'))).toEqual([
        400,
        'CART_TIME_CLASH',
      ]);
      expect((await put(tueB, 'anna', '11:00', '12:00')).status).toBe(201);
    });

    it('never more than four at any half-hour, even when six are put on at once', async () => {
      const six = ['boris', 'clara', 'dan', 'eva', 'fedor', 'gleb'];
      const res = await Promise.all(
        six.map((w) => put(thuA, w, '10:00', '12:00')),
      );
      expect(res.filter((r) => r.status === 201)).toHaveLength(4);
      expect(
        res
          .filter((r) => r.status === 400)
          .every((r) => r.body.code === 'CART_SLOT_FULL'),
      ).toBe(true);
      // A fifth after them is fine: the four leave at twelve.
      const left = six.find((w, i) => res[i].status === 400)!;
      expect((await put(thuA, left, '12:00', '13:00')).status).toBe(201);
      const v = (await view('boss', week)).days.find((x) => x.id === thuA)!;
      for (const p of v.plan!)
        await h.as('boss').delete(`/cart/assignments/${p.id}`);
    });

    it('«Предложить состав» puts the pioneer first and nobody twice', async () => {
      for (const w of ['dan', 'eva', 'fedor', 'gleb', 'pio']) {
        expect((await ask(w, thuA, '10:00', '12:00')).status).toBe(201);
      }
      const res = await h.as('boss').post(`/cart-weeks/${weekId}/suggest`);
      expect(res.status).toBe(200);
      const v = (await view('boss', week)).days.find((x) => x.id === thuA)!;
      const on = v.plan!.map((p) => p.publisherId);
      expect(on).toContain(pid.pio);
      expect(on).toHaveLength(4);
      expect(new Set(on).size).toBe(4);
      // Tuesday: Boris and Clara were added beside Anna; nobody twice.
      const t = (await view('boss', week)).days.find((x) => x.id === tueA)!;
      expect(t.plan!.filter((p) => p.publisherId === pid.anna)).toHaveLength(2);
    });

    it('publishing tells each his own time and who stands with him — and the others nothing', async () => {
      const outFirst = (await view('boss', week)).days
        .find((x) => x.id === thuA)!
        .plan!.map((p) => p.publisherId);
      const leftOut = ['dan', 'eva', 'fedor', 'gleb'].find(
        (w) => !outFirst.includes(pid[w]),
      )!;
      expect(
        (await h.as('boss').post(`/cart-weeks/${weekId}/publish`)).status,
      ).toBe(201);
      const told = await outbox('cart_published');
      const anna = told.filter((r) => r.user_id === uid.anna);
      expect(anna).toHaveLength(1);
      expect(anna[0].body).toContain('09:00–11:00 · Bahnhof (стенд)');
      expect(anna[0].body).toContain('Тест boris');
      expect(told.some((r) => r.user_id === uid[leftOut])).toBe(false);
      // Not chosen: his wish is no longer shown to him.
      const mine = (await view(leftOut, week)).days.find((x) => x.id === thuA)!;
      expect(mine.myRequests).toEqual([]);
      expect(sent.find((s) => s.kind === 'cart_published')!.emailFallback).toBe(
        true,
      );
      expect(categoryOfKind('cart_published')).toBe('assignments');
      expect(categoryOfKind('cart_open')).toBe('ministry');
    });

    it('a request for free time after publication is a real one, and is told', async () => {
      expect((await ask('gleb', tueA, '14:00', '16:00')).status).toBe(201);
      const d = (await view('boss', week)).days.find((x) => x.id === tueA)!;
      expect(d.wishes!.find((w) => w.publisherId === pid.gleb)!.late).toBe(
        true,
      );
      expect((await toldTo('cart_dobor_request')).has(uid.boss)).toBe(true);
      const g = (await view('gleb', week)).days.find((x) => x.id === tueA)!;
      expect(g.myRequests).toHaveLength(1);
    });

    it('put on, moved, taken off: he hears each, and so do those beside him', async () => {
      const add = await put(tueA, 'gleb', '14:00', '16:00');
      expect(add.status).toBe(201);
      expect((await toldTo('cart_assigned')).has(uid.gleb)).toBe(true);
      // Anna stands 13–15: she learns her crew changed.
      expect((await toldTo('cart_crew_changed')).has(uid.anna)).toBe(true);
      const moved = await h
        .as('boss')
        .patch(`/cart/assignments/${add.body.id}`, {
          startTime: '14:30',
          endTime: '16:00',
        });
      expect(moved.status).toBe(200);
      expect((await toldTo('cart_changed')).has(uid.gleb)).toBe(true);
      expect(
        (await h.as('boss').delete(`/cart/assignments/${add.body.id}`)).status,
      ).toBe(204);
      expect((await toldTo('cart_unassigned')).has(uid.gleb)).toBe(true);
    });

    it('«не смогу»: whoever arranges, the partner, and who asked for that time hear it', async () => {
      // Clara asked for Tuesday 10–11:30 and is not on; Boris stands 09–12.
      const t = (await view('boss', week)).days.find((x) => x.id === tueA)!;
      const claraOn = t.plan!.find((p) => p.publisherId === pid.clara);
      if (claraOn) await h.as('boss').delete(`/cart/assignments/${claraOn.id}`);
      const borisOn = (await view('boris', week)).days.find(
        (x) => x.id === tueA,
      )!.mine[0];
      const res = await h
        .as('boris')
        .delete(`/cart/assignments/${borisOn.id}/mine`);
      expect(res.status).toBe(204);
      expect((await toldTo('cart_cancel')).has(uid.boss)).toBe(true);
      expect((await toldTo('cart_partner_cancel')).has(uid.anna)).toBe(true);
      expect((await toldTo('cart_place_free')).has(uid.clara)).toBe(true);
      const left = await h.sql(
        `SELECT 1 FROM cart_requests WHERE day_id = $1 AND publisher_id = $2`,
        [tueA, pid.boris],
      );
      expect(left).toHaveLength(0);
    });

    it('part of a day called off keeps the plan, and comes back as it was', async () => {
      const off = await h.as('boss').post(`/cart/days/${tueA}/cancel`, {
        startTime: '13:00',
        endTime: '16:00',
        reason: 'непогода',
      });
      expect(off.status).toBe(201);
      const told = (await outbox('cart_shift_cancelled')).filter(
        (r) => r.user_id === uid.anna,
      );
      expect(told).toHaveLength(1);
      expect(told[0].body).toContain('13:00–15:00');
      expect(told[0].body).toContain('Причина: непогода');
      expect(code(await ask('dan', tueA, '14:00', '15:00'))).toEqual([
        400,
        'CART_SLOT_CANCELLED',
      ]);
      expect(code(await put(tueA, 'dan', '13:00', '14:00'))).toEqual([
        400,
        'CART_SLOT_CANCELLED',
      ]);
      const anna = (await view('anna', week)).days.find((x) => x.id === tueA)!;
      expect(anna.mine).toHaveLength(2);
      expect(anna.cancellations[0].reason).toBe('непогода');
      expect(
        (await h.as('boss').delete(`/cart/cancellations/${off.body.id}`))
          .status,
      ).toBe(204);
      expect((await toldTo('cart_shift_restored')).has(uid.anna)).toBe(true);
      expect(
        (await view('anna', week)).days.find((x) => x.id === tueA)!
          .cancellations,
      ).toEqual([]);
    });

    it('a planned week is not wiped, nor a day with people on it, nor its hours cut under them', async () => {
      expect(code(await h.as('boss').delete(`/cart-weeks/${weekId}`))).toEqual([
        409,
        'CART_WEEK_HAS_PEOPLE',
      ]);
      expect(code(await h.as('boss').delete(`/cart/days/${tueA}`))).toEqual([
        409,
        'CART_DAY_HAS_PEOPLE',
      ]);
      expect(
        code(
          await h.as('boss').patch(`/cart/days/${tueA}`, {
            startTime: '10:00',
            endTime: '16:00',
          }),
        ),
      ).toEqual([409, 'CART_DAY_HAS_PEOPLE']);
    });

    it('a place days were planned at is switched off, not deleted', async () => {
      expect(
        code(await h.as('boss').delete(`/cart-locations/${locB}`)),
      ).toEqual([409, 'CART_LOCATION_IN_USE']);
      const said = await h.sql(
        `SELECT 1 FROM audit_logs WHERE entity_type = 'cart_location' AND action = 'DELETE' AND entity_id = $1`,
        [locB],
      );
      expect(said).toHaveLength(0);
    });

    it('the journal says who was put on, where and when', async () => {
      const rows = await h.db.getRepository(AuditLog).find({
        where: { entityType: 'cart_assignment', action: 'CREATE' },
      });
      const anna = rows.find((r) => r.subjectId === pid.anna)!;
      expect(JSON.parse(anna.afterJson!)).toMatchObject({
        place: 'Bahnhof',
        time: '09:00–11:00',
      });
    });
  });

  describe('time, archive, reminders', () => {
    const today = () =>
      h
        .sql<{
          d: string;
        }>(`SELECT (now() AT TIME ZONE 'Europe/Berlin')::date::text AS d`)
        .then((r) => r[0].d);

    it('nothing signed up to that has begun; nothing given back that is over', async () => {
      const past = mondayIn(-1);
      const weekId = await buildPast(past, [1], [locA], '09:00', '11:00');
      // Sign-up no longer opens onto a week that is over; set as it was.
      await h.sql(`UPDATE cart_weeks SET status = 'collecting' WHERE id = $1`, [
        weekId,
      ]);
      const day = await dayOf(past, past, locA);
      expect(code(await ask('dan', day, '09:00', '11:00'))).toEqual([
        400,
        'CART_SLOT_PAST',
      ]);
      const on = await put(day, 'dan', '09:00', '11:00');
      expect(on.status).toBe(201);
      expect(
        code(await h.as('dan').delete(`/cart/assignments/${on.body.id}/mine`)),
      ).toEqual([400, 'CART_SLOT_PAST']);
    });

    it('a week after, a day is archive: nobody changes it', async () => {
      const old = mondayIn(-3);
      const weekId = await buildPast(old, [2], [locA], '10:00', '12:00');
      const day = await dayOf(old, addDays(old, 1), locA);
      await h.sql(
        `UPDATE cart_weeks SET status = 'published', published_at = now() WHERE id = $1`,
        [weekId],
      );
      await h.sql(
        `INSERT INTO cart_assignments (congregation_id, day_id, publisher_id, start_time, end_time)
         VALUES ($1, $2, $3, '10:00', '12:00'), ($1, $2, NULL, '10:00', '11:00')`,
        [tenant, day, pid.eva],
      );
      await h.sql(
        `UPDATE cart_assignments SET external_name = 'Гость' WHERE publisher_id IS NULL`,
      );
      // The last half-hour was called off: it was not served.
      await h.sql(
        `INSERT INTO cart_cancellations (congregation_id, day_id, start_time, end_time, reason)
         VALUES ($1, $2, '11:30', '12:00', 'дождь')`,
        [tenant, day],
      );
      expect(code(await put(day, 'dan', '10:00', '12:00'))).toEqual([
        409,
        'CART_DAY_LOCKED',
      ]);
      const [asg] = await h.sql<{ id: string }>(
        `SELECT id FROM cart_assignments WHERE day_id = $1 AND publisher_id = $2`,
        [day, pid.eva],
      );
      expect(
        code(await h.as('boss').delete(`/cart/assignments/${asg.id}`)),
      ).toEqual([409, 'CART_DAY_LOCKED']);
      expect(
        code(await h.as('boss').post(`/cart/days/${day}/cancel`, {})),
      ).toEqual([409, 'CART_DAY_LOCKED']);
      expect(code(await h.as('boss').delete(`/cart-weeks/${weekId}`))).toEqual([
        409,
        'CART_WEEK_HAS_PEOPLE',
      ]);
    });

    it('the archive is what was really served, since the circuit overseer last came', async () => {
      const t = await today();
      // His last visit ended five weeks ago: the archive starts the day after.
      const visitEnd = addDays(t, -35);
      await h.sql(
        `INSERT INTO special_events (congregation_id, title, type, date, end_date)
         VALUES ($1, 'Визит', 'circuit_overseer_visit', $2, $3)`,
        [tenant, addDays(visitEnd, -5), visitEnd],
      );
      const res = await h.as('boss').get('/cart-weeks/archive');
      expect(res.status).toBe(200);
      expect(res.body.from).toBe(addDays(visitEnd, 1));
      const day = res.body.days.find((d: { people: { name: string }[] }) =>
        d.people.some((p) => p.name === 'Тест eva'),
      );
      expect(day.people).toEqual([
        { name: 'Тест eva', startTime: '10:00', endTime: '11:30' },
        { name: 'Гость', startTime: '10:00', endTime: '11:00' },
      ]);
      expect(day.minutes).toBe(150);
      expect(
        res.body.totals.calledOff.some(
          (c: { reason: string }) => c.reason === 'дождь',
        ),
      ).toBe(true);
      expect(res.body.totals.people).toBeGreaterThanOrEqual(2);
      // Nobody but whoever arranges reads it.
      expect((await h.as('anna').get('/cart-weeks/archive')).status).toBe(403);
    });

    it('the evening before, his time is in the digest — hours, place, partners', async () => {
      const t = await today();
      const tomorrow = addDays(t, 1);
      const dow = ((new Date(`${tomorrow}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
      const monday = addDays(tomorrow, 1 - dow);
      const weekId = await build(monday, [dow], [locA], '16:00', '19:00');
      await h.as('boss').post(`/cart-weeks/${weekId}/open`);
      const day = await dayOf(monday, tomorrow, locA);
      expect((await put(day, 'fedor', '16:00', '18:00')).status).toBe(201);
      expect((await put(day, 'gleb', '17:00', '19:00')).status).toBe(201);
      await h.as('boss').post(`/cart-weeks/${weekId}/publish`);
      await h.app.get(AssignmentRemindersService).sendDigests(tenant, t);
      const bodies = (
        await h.sql<{ body: string }>(
          `SELECT body FROM notification_outbox WHERE kind = 'assignment_reminder' AND user_id = $1`,
          [uid.fedor],
        )
      ).map((r) => r.body);
      expect(bodies.join('\n')).toContain(
        '16:00–18:00: стенд Bahnhof, вместе: Тест gleb (17:00–19:00)',
      );
    });

    it('what is near goes out at once, even at night; what is far waits for the morning', async () => {
      const [{ d: t, m }] = await h.sql<{ d: string; m: number }>(
        `SELECT (now() AT TIME ZONE 'Europe/Berlin')::date::text AS d,
                extract(hour FROM now() AT TIME ZONE 'Europe/Berlin') * 60 +
                extract(minute FROM now() AT TIME ZONE 'Europe/Berlin') AS m`,
      );
      const hh = (x: number) =>
        `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
      // A time within twelve hours: later today if the evening allows,
      // otherwise tomorrow at seven.
      let date = t;
      let start = Math.ceil((Number(m) + 30) / 30) * 30;
      if (start + 60 > 23 * 60 + 30) {
        date = addDays(t, 1);
        start = 7 * 60;
      }
      const near = { date, from: hh(start), to: hh(start + 60) };
      const far = { date: addDays(t, 3), from: '10:00', to: '11:00' };
      for (const x of [near, far]) {
        const dow = ((new Date(`${x.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
        const monday = addDays(x.date, 1 - dow);
        const weekId = await build(monday, [dow], [locB], x.from, x.to);
        await h.sql(
          `UPDATE cart_locations SET is_active = true WHERE id = $1`,
          [locB],
        );
        await h.as('boss').post(`/cart-weeks/${weekId}/open`);
        const day = await dayOf(monday, x.date, locB);
        await put(day, 'clara', x.from, x.to);
        await put(day, 'dan', x.from, x.to);
        const st = (await view('boss', monday)).status;
        if (st !== 'published')
          await h.as('boss').post(`/cart-weeks/${weekId}/publish`);
        const mine = (await view('dan', monday)).days.find(
          (d) => d.id === day,
        )!.mine;
        sent.length = 0;
        await h.as('dan').delete(`/cart/assignments/${mine[0].id}/mine`);
        const partner = sent.find((s) => s.kind === 'cart_partner_cancel')!;
        expect([x === near ? 'near' : 'far', partner.urgent]).toEqual([
          x === near ? 'near' : 'far',
          x === near,
        ]);
        expect(partner.emailFallback).toBe(true);
      }
    });

    it('reminders: sign-up closing, collecting due, an unpublished week, a permit ending', async () => {
      const t = await today();
      const wk = mondayIn(2);
      const weekId = await build(wk, [3], [locA], '10:00', '12:00');
      await h
        .as('boss')
        .post(`/cart-weeks/${weekId}/open`, { signupUntil: addDays(t, 1) });
      await h
        .as('boss')
        .patch(`/cart-locations/${locA}`, { permitUntil: addDays(t, 20) });
      const rem = h.app.get(CartRemindersService);
      await rem.runFor(tenant);
      expect((await toldTo('cart_signup_reminder')).has(uid.dan)).toBe(true);
      expect((await toldTo('cart_permit')).has(uid.boss)).toBe(true);
      // Sign-up closes today: whoever arranges is asked to gather the plan.
      await h.sql(`UPDATE cart_weeks SET signup_until = $2 WHERE id = $1`, [
        weekId,
        t,
      ]);
      await rem.runFor(tenant);
      expect((await toldTo('cart_collect_due')).has(uid.boss)).toBe(true);
      // A week two days off with no published plan.
      await h.sql(`UPDATE cart_weeks SET week_start_date = $2 WHERE id = $1`, [
        weekId,
        addDays(t, 2),
      ]);
      await rem.runFor(tenant);
      expect((await toldTo('cart_unpublished')).has(uid.boss)).toBe(true);
      // A second run says nothing new.
      const n = (await outbox('cart_permit')).length;
      await rem.runFor(tenant);
      expect((await outbox('cart_permit')).length).toBe(n);
    });
  });

  it('«повторить прошлую неделю»: the same days, nobody on them', async () => {
    const from = mondayIn(8);
    await build(from, [2, 6], [locA, locB]);
    const target = mondayIn(9);
    // Markt is switched off since: it is not repeated.
    await h.as('boss').patch(`/cart-locations/${locB}`, { isActive: false });
    const res = await h
      .as('boss')
      .post('/cart-weeks/copy', { weekStartDate: target });
    expect(res.status).toBe(201);
    const v = await view('boss', target);
    expect(v.days.map((d) => `${d.date}|${d.locationId}`).sort()).toEqual(
      [2, 6].map((d) => `${addDays(target, d - 1)}|${locA}`).sort(),
    );
    expect(v.days.every((d) => (d.plan ?? []).length === 0)).toBe(true);
    const again = await h
      .as('boss')
      .post('/cart-weeks/copy', { weekStartDate: target });
    expect(again.body.added).toBe(0);
    expect(
      code(
        await h
          .as('boss')
          .post('/cart-weeks/copy', { weekStartDate: mondayIn(-40) }),
      ),
    ).toEqual([400, 'CART_NOTHING_TO_COPY']);
  });
  describe('«с кем» chosen from the list (2 November 2026)', () => {
    const week = mondayIn(11);
    let day = '';
    beforeAll(async () => {
      // Two brothers alike in everything: never at the stand, no pioneers.
      for (const n of ['kai', 'leo']) {
        pid[n] = await h.addPublisher({
          firstName: n,
          lastName: 'Тест',
          gender: 'brother',
          appointment: 'publisher',
          baptismDate: '1990-01-01',
        });
        await h.sql(
          `UPDATE publishers SET status = 'active', status_manually_overridden = true,
                  capabilities = '{"public_witnessing": true}'::jsonb WHERE id = $1`,
          [pid[n]],
        );
        uid[n] = await h.addUser({
          login: n,
          role: 'publisher',
          publisherId: pid[n],
        });
      }
      const id = await build(week, [3], [locA]);
      await h.as('boss').post(`/cart-weeks/${id}/open`, {});
      day = await dayOf(week, addDays(week, 2), locA);
    });
    const askWith = (who: string, a: string, b: string, ids: string[]) =>
      h.as(who).post(`/cart/days/${day}/requests`, {
        startTime: a,
        endTime: b,
        withPublisherIds: ids,
      });

    it('the list: whom the stand is open to, names only, not oneself', async () => {
      const res = await h.as('anna').get('/cart-weeks/partners');
      expect(res.status).toBe(200);
      const ids = (res.body as { id: string; name: string }[]).map((x) => x.id);
      expect(ids).toContain(pid.boris);
      expect(ids).toContain(pid.boss);
      // Not herself, not the unapproved, the unbaptized or the inactive.
      for (const n of ['anna', 'nocard', 'novice', 'away'])
        expect(ids).not.toContain(pid[n]);
      expect(Object.keys(res.body[0]).sort()).toEqual(['id', 'name']);
      // Not open to whoever the stand is not open to.
      expect(code(await h.as('nocard').get('/cart-weeks/partners'))).toEqual([
        403,
        'CART_NOT_ELIGIBLE',
      ]);
    });

    it('only cards from the list, up to two; whoever arranges reads them, nobody else', async () => {
      expect(
        code(await askWith('anna', '09:00', '11:00', [pid.nocard])),
      ).toEqual([400, 'CART_PARTNER_UNKNOWN']);
      expect(
        code(
          await askWith('anna', '09:00', '11:00', [
            pid.boris,
            pid.clara,
            pid.dan,
          ]),
        )[0],
      ).toBe(400);
      expect(
        (await askWith('anna', '09:00', '11:00', [pid.boris, pid.anna])).status,
      ).toBe(201);
      const boss = (await view('boss', week)).days.find((d) => d.id === day)!;
      const w = (boss.wishes ?? []).find((x) => x.publisherId === pid.anna) as {
        withPublishers?: { id: string; name: string }[];
      };
      // Herself is dropped from her own choice.
      expect(w.withPublishers?.map((x) => x.id)).toEqual([pid.boris]);
      const boris = (await view('boris', week)).days.find((d) => d.id === day)!;
      expect(JSON.stringify(boris)).not.toContain('withPublishers');
      const mine = (await view('anna', week)).days.find((d) => d.id === day)!
        .myRequests[0] as { withPublishers?: { id: string }[] };
      expect(mine.withPublishers?.map((x) => x.id)).toEqual([pid.boris]);
    });

    it('«предложить состав»: all else equal, beside whom one asked for', async () => {
      // Two brothers ask the same time, equal in everything; the four places
      // of the hour are taken but one, and anna asked for kai.
      await h
        .as('anna')
        .delete(
          `/cart/requests/${
            (await view('anna', week)).days.find((d) => d.id === day)!
              .myRequests[0].id
          }`,
        );
      expect((await askWith('anna', '09:00', '11:00', [pid.kai])).status).toBe(
        201,
      );
      await askWith('kai', '09:00', '11:00', []);
      await askWith('leo', '09:00', '11:00', []);
      await put(day, 'eva', '09:00', '11:00');
      await put(day, 'fedor', '09:00', '11:00');
      await put(day, 'anna', '09:00', '11:00');
      await h.sql(
        `UPDATE cart_requests SET created_at = now() - interval '1 hour' WHERE day_id = $1 AND publisher_id = $2`,
        [day, pid.leo],
      );
      const w = await view('boss', week);
      const res = await h.as('boss').post(`/cart-weeks/${w.id}/suggest`, {});
      expect(res.status).toBe(200);
      const plan = (await view('boss', week)).days.find(
        (d) => d.id === day,
      )!.plan!;
      const on = plan.map((p) => p.publisherId);
      // Leo asked first and would win by time alone; kai stands beside anna.
      expect(on).toContain(pid.kai);
      expect(on).not.toContain(pid.leo);
    });
  });
  describe('before sign-up opens (2 November 2026)', () => {
    it('a day already over is not planned; all over is a refusal', async () => {
      // A whole past week: nothing to add.
      const past = await h.as('boss').post('/cart-weeks', {
        weekStartDate: mondayIn(-1),
        startTime: '09:00',
        endTime: '12:00',
        daysOfWeek: [1, 3],
        locationIds: [locA],
      });
      expect(code(past)).toEqual([400, 'CART_DAYS_PAST']);
      // This week, every day 09:00–12:00: what is over by the congregation's
      // clock is left out and counted, whatever day and hour the test runs.
      const [{ d: today, m }] = await h.sql<{ d: string; m: number }>(
        `SELECT (now() AT TIME ZONE 'Europe/Berlin')::date::text AS d,
                (extract(hour FROM now() AT TIME ZONE 'Europe/Berlin') * 60
                 + extract(minute FROM now() AT TIME ZONE 'Europe/Berlin'))::int AS m`,
      );
      const monday = mondayIn(0);
      const all = [1, 2, 3, 4, 5, 6, 7];
      const over = all.filter((dow) => {
        const date = addDays(monday, dow - 1);
        return date < today || (date === today && m >= 12 * 60);
      });
      const res = await h.as('boss').post('/cart-weeks', {
        weekStartDate: monday,
        startTime: '09:00',
        endTime: '12:00',
        daysOfWeek: all,
        locationIds: [locA],
      });
      if (over.length === 7) {
        expect(code(res)).toEqual([400, 'CART_DAYS_PAST']);
        return;
      }
      expect(res.status).toBe(201);
      expect(res.body.skippedPast).toBe(over.length);
      const v = await view('boss', monday);
      const dates = v.days
        .filter((d) => d.locationId === locA)
        .map((d) => d.date);
      for (const dow of over)
        expect(dates).not.toContain(addDays(monday, dow - 1));
      expect(dates.length).toBe(7 - over.length);
    });

    it('sign-up does not open onto an empty week; the deadline lies between today and the last day', async () => {
      const week = mondayIn(13);
      // An empty week: made by repeating nothing is not possible, so a day is
      // added and deleted again.
      const id = await build(week, [2, 4], [locA]);
      const v = await view('boss', week);
      for (const d of v.days) await h.as('boss').delete(`/cart/days/${d.id}`);
      expect(
        code(await h.as('boss').post(`/cart-weeks/${id}/open`, {})),
      ).toEqual([400, 'CART_WEEK_EMPTY']);
      await build(week, [2, 4], [locA]);
      const thu = addDays(week, 3);
      expect(
        code(
          await h
            .as('boss')
            .post(`/cart-weeks/${id}/open`, { signupUntil: addDays(thu, 1) }),
        ),
      ).toEqual([400, 'CART_BAD_DEADLINE']);
      expect(
        code(
          await h.as('boss').post(`/cart-weeks/${id}/open`, {
            signupUntil: addDays(new Date().toISOString().slice(0, 10), -1),
          }),
        ),
      ).toEqual([400, 'CART_BAD_DEADLINE']);
      const ok = await h
        .as('boss')
        .post(`/cart-weeks/${id}/open`, { signupUntil: thu });
      expect(ok.status).toBe(201);
    });

    it('«повторить»: says beforehand which week and which days, or nothing', async () => {
      const target = mondayIn(30);
      // The week before has both places; Markt has been switched off since,
      // so neither the preview nor the copy brings it.
      await h.sql(`UPDATE cart_locations SET is_active = true WHERE id = $1`, [
        locB,
      ]);
      await build(mondayIn(29), [2], [locA, locB]);
      await h.sql(`UPDATE cart_locations SET is_active = false WHERE id = $1`, [
        locB,
      ]);
      const src = (
        await h.as('boss').get(`/cart-weeks/copy-source?weekStart=${target}`)
      ).body as {
        weekStartDate: string;
        days: { weekday: number; locationName: string }[];
      } | null;
      expect(src).not.toBeNull();
      expect(src!.weekStartDate).toBe(mondayIn(29));
      expect(src!.days.map((d) => d.locationName)).toEqual(['Bahnhof']);
      // The latest earlier week that has days, as copy itself takes it.
      const copied = await h
        .as('boss')
        .post('/cart-weeks/copy', { weekStartDate: target });
      expect(copied.status).toBe(201);
      expect(copied.body.added).toBe(src!.days.length);
      expect(
        (
          await h
            .as('boss')
            .get(`/cart-weeks/copy-source?weekStart=${mondayIn(-60)}`)
        ).body,
      ).toEqual({});
      expect(
        (await h.as('anna').get(`/cart-weeks/copy-source?weekStart=${target}`))
          .status,
      ).toBe(403);
    });
  });
});
