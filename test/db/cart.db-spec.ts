import { Harness, startHarness } from './harness';
import { AuditLog } from '../../src/entities/audit-log.entity';
import { AssignmentRemindersService } from '../../src/assignment-reminders/assignment-reminders.service';

/**
 * The stand made ready for use, against a real database (2 November 2026).
 *
 * Every rule found missing in the audit of that day is held here: what a
 * shift may hold, who may stand at all, what the people on a plan are told,
 * what may be changed or wiped and what may not — and that a shift called
 * off keeps its crew. Each was also checked the other way round: the rule
 * switched off, the test failing.
 */
describe('public witnessing — the stand (real database)', () => {
  let h: Harness;
  let tenant = '';
  const pid: Record<string, string> = {};
  const uid: Record<string, string> = {};

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

  let locA = '';
  let locB = '';

  const build = async (
    week: string,
    days: number[],
    locs: string[],
    from = '10:00',
    to = '14:00',
  ) => {
    const res = await h.as('boss').post('/cart-weeks', {
      weekStartDate: week,
      startTime: from,
      endTime: to,
      stepMinutes: 120,
      daysOfWeek: days,
      locationIds: locs,
    });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const view = async (who: string, week: string) => {
    const res = await h.as(who).get(`/cart-weeks?weekStart=${week}`);
    expect(res.status).toBe(200);
    return res.body as {
      id: string;
      status: string;
      slots: {
        id: string;
        date: string;
        startTime: string;
        locationId: string;
        myRequest: boolean;
        myAssignment?: boolean;
        cancelled: { reason: string | null } | null;
        equipmentAt: string | null;
        assignments?: {
          id: string;
          publisherId: string | null;
          name: string;
        }[];
        requests?: { publisherId: string; late: boolean; absent: boolean }[];
      }[];
    };
  };
  const assign = (slot: string, who: string) =>
    h
      .as('boss')
      .post(`/cart-slots/${slot}/assignments`, { publisherId: pid[who] });

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const card = async (
      login: string,
      gender: 'brother' | 'sister',
      appointment: string,
      approved: boolean,
    ) => {
      pid[login] = await h.addPublisher({
        firstName: login,
        lastName: 'Тест',
        gender,
        appointment,
        ...(appointment === 'publisher' || appointment === 'elder'
          ? { baptismDate: '1990-01-01' }
          : {}),
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
    await card('anna', 'sister', 'publisher', true);
    await card('boris', 'brother', 'publisher', true);
    await card('clara', 'sister', 'publisher', true);
    await card('dan', 'brother', 'publisher', true);
    await card('eva', 'sister', 'publisher', true);
    await card('fedor', 'brother', 'publisher', true);
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

  it('a week starts on a Monday, and a bad date is a refusal, not a 500', async () => {
    const tuesday = addDays(mondayIn(5), 1);
    const res = await h.as('boss').post('/cart-weeks', {
      weekStartDate: tuesday,
      startTime: '10:00',
      endTime: '12:00',
      stepMinutes: 60,
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
    let weekId = '';
    let s1 = ''; // Tue 10–12 at Bahnhof
    let s1b = ''; // Tue 10–12 at Markt — the same hour elsewhere
    let s2 = ''; // Tue 12–14 at Bahnhof

    beforeAll(async () => {
      weekId = await build(week, [2], [locA, locB]);
      const v = await view('boss', week);
      const at = (loc: string, t: string) =>
        v.slots.find((s) => s.locationId === loc && s.startTime === t)!.id;
      s1 = at(locA, '10:00');
      s1b = at(locB, '10:00');
      s2 = at(locA, '12:00');
    });

    it('a draft shows the others nothing of what is in it', async () => {
      const v = await view('anna', week);
      expect(v.status).toBe('draft');
      expect(v.slots).toEqual([]);
    });

    it('opening it tells everyone approved and baptized — and nobody else', async () => {
      expect(
        (await h.as('boss').post(`/cart-weeks/${weekId}/open`)).status,
      ).toBe(201);
      const told = new Set((await outbox('cart_open')).map((r) => r.user_id));
      for (const who of [
        'anna',
        'boris',
        'clara',
        'dan',
        'eva',
        'fedor',
        'boss',
      ]) {
        expect([who, told.has(uid[who])]).toEqual([who, true]);
      }
      for (const who of ['nocard', 'novice', 'away']) {
        expect([who, told.has(uid[who])]).toEqual([who, false]);
      }
    });

    it('only the approved and baptized may sign up, or be put on', async () => {
      expect(
        code(await h.as('nocard').post(`/cart-slots/${s1}/request`, {})),
      ).toEqual([403, 'CART_NOT_ELIGIBLE']);
      expect(
        code(await h.as('novice').post(`/cart-slots/${s1}/request`, {})),
      ).toEqual([403, 'CART_NOT_ELIGIBLE']);
      expect(code(await assign(s1, 'nocard'))).toEqual([
        400,
        'CART_NOT_APPROVED',
      ]);
      expect(code(await assign(s1, 'novice'))).toEqual([
        400,
        'CART_NOT_BAPTIZED',
      ]);
    });

    it('wishes are made, with whom one would like to stand', async () => {
      for (const who of ['anna', 'boris', 'clara']) {
        expect(
          (
            await h
              .as(who)
              .post(`/cart-slots/${s1}/request`, { withWhomNote: ' Dan ' })
          ).status,
        ).toBe(201);
      }
      const mine = (await view('anna', week)).slots.find((s) => s.id === s1)!;
      expect(mine.myRequest).toBe(true);
      const req = (await view('boss', week)).slots
        .find((s) => s.id === s1)!
        .requests!.find((r) => r.publisherId === pid.anna)!;
      expect(req.late).toBe(false);
    });

    it('nobody is in two places at the same hour', async () => {
      expect((await assign(s1, 'anna')).status).toBe(201);
      expect(code(await assign(s1b, 'anna'))).toEqual([400, 'CART_TIME_CLASH']);
      // The next shift at the same place is a second shift, not a clash.
      expect((await assign(s2, 'anna')).status).toBe(201);
    });

    it('a shift holds four, even when six are put in at once', async () => {
      const slot = s1b;
      const six = ['boris', 'clara', 'dan', 'eva', 'fedor', 'boss'];
      const res = await Promise.all(six.map((w) => assign(slot, w)));
      const ok = res.filter((r) => r.status === 201).length;
      expect(ok).toBe(4);
      expect(
        res
          .filter((r) => r.status === 400)
          .every((r) => r.body.code === 'CART_SLOT_FULL'),
      ).toBe(true);
      const n = await h.sql<{ n: number }>(
        `SELECT count(*)::int AS n FROM cart_assignments WHERE slot_id = $1`,
        [slot],
      );
      expect(n[0].n).toBe(4);
      // Back to an empty place for what follows.
      const v = await view('boss', week);
      for (const a of v.slots.find((s) => s.id === slot)!.assignments!) {
        await h.as('boss').delete(`/cart-slots/${slot}/assignments/${a.id}`);
      }
    });

    it('publishing tells each one his own shifts, with whom — and the others nothing', async () => {
      expect((await assign(s1, 'boris')).status).toBe(201);
      expect(
        (await h.as('boss').post(`/cart-weeks/${weekId}/publish`)).status,
      ).toBe(201);
      const told = await outbox('cart_published');
      const to = (who: string) => told.filter((r) => r.user_id === uid[who]);
      expect(to('anna')).toHaveLength(1);
      expect(to('anna')[0].body).toContain('Bahnhof (стенд)');
      expect(to('anna')[0].body).toContain('вместе: Тест boris');
      expect(to('boris')[0].body).toContain('вместе: Тест anna');
      // Clara wished and was not chosen: not a word to her.
      expect(to('clara')).toHaveLength(0);
    });

    it('a wish that was not granted is no longer shown to its author', async () => {
      const clara = (await view('clara', week)).slots.find((s) => s.id === s1)!;
      expect(clara.myRequest).toBe(false);
      expect(clara.myAssignment).toBe(false);
      // He who arranges still sees who wanted the shift.
      const boss = (await view('boss', week)).slots.find((s) => s.id === s1)!;
      expect(boss.requests!.map((r) => r.publisherId)).toContain(pid.clara);
    });

    it('a request for a free place after publication is a real one', async () => {
      expect(
        (await h.as('clara').post(`/cart-slots/${s1}/request`, {})).status,
      ).toBe(201);
      const clara = (await view('clara', week)).slots.find((s) => s.id === s1)!;
      expect(clara.myRequest).toBe(true);
      const req = (await view('boss', week)).slots
        .find((s) => s.id === s1)!
        .requests!.find((r) => r.publisherId === pid.clara)!;
      expect(req.late).toBe(true);
      expect(
        (await outbox('cart_dobor_request')).map((r) => r.user_id),
      ).toContain(uid.boss);
    });

    it('put on after publication: he hears it at once; taken off: the same', async () => {
      const add = await assign(s1, 'clara');
      expect(add.status).toBe(201);
      expect((await outbox('cart_assigned')).map((r) => r.user_id)).toContain(
        uid.clara,
      );
      await h.as('boss').delete(`/cart-slots/${s1}/assignments/${add.body.id}`);
      expect((await outbox('cart_unassigned')).map((r) => r.user_id)).toContain(
        uid.clara,
      );
    });

    it('«не смогу»: the arranger and the partner are told; the wish goes too', async () => {
      const res = await h.as('boris').delete(`/cart-slots/${s1}/my-assignment`);
      expect(res.status).toBe(204);
      expect((await outbox('cart_cancel')).map((r) => r.user_id)).toEqual([
        uid.boss,
      ]);
      const partner = await outbox('cart_partner_cancel');
      expect(partner.map((r) => r.user_id)).toEqual([uid.anna]);
      expect(partner[0].body).toContain('Тест boris');
      const left = await h.sql(
        `SELECT 1 FROM cart_requests WHERE slot_id = $1 AND publisher_id = $2`,
        [s1, pid.boris],
      );
      expect(left).toHaveLength(0);
    });

    it('a shift called off keeps its crew, and comes back as it was', async () => {
      const off = await h.as('boss').post(`/cart-weeks/${weekId}/cancel`, {
        slotIds: [s1, s2],
        reason: 'непогода',
      });
      expect(off.status).toBe(200);
      let v = (await view('anna', week)).slots.find((s) => s.id === s1)!;
      expect(v.cancelled).toEqual({ reason: 'непогода' });
      expect(v.myAssignment).toBe(true);
      // Anna stands in both: one message names both, and the reason.
      const told = (await outbox('cart_shift_cancelled')).filter(
        (r) => r.user_id === uid.anna,
      );
      expect(told).toHaveLength(1);
      expect(told[0].title).toBe('Смены отменены');
      expect(told[0].body).toContain('Причина: непогода');
      expect(
        code(await h.as('dan').post(`/cart-slots/${s1}/request`, {})),
      ).toEqual([400, 'CART_SLOT_CANCELLED']);
      expect(code(await assign(s1, 'dan'))).toEqual([
        400,
        'CART_SLOT_CANCELLED',
      ]);

      const on = await h
        .as('boss')
        .post(`/cart-weeks/${weekId}/restore`, { slotIds: [s1] });
      expect(on.body.changed).toBe(1);
      v = (await view('anna', week)).slots.find((s) => s.id === s1)!;
      expect(v.cancelled).toBeNull();
      expect(v.myAssignment).toBe(true);
      expect(
        (await outbox('cart_shift_restored')).map((r) => r.user_id),
      ).toContain(uid.anna);
    });

    it('a planned week is not wiped, nor a shift with people in it', async () => {
      expect(code(await h.as('boss').delete(`/cart-weeks/${weekId}`))).toEqual([
        409,
        'CART_WEEK_HAS_PEOPLE',
      ]);
      expect(code(await h.as('boss').delete(`/cart-slots/${s1}`))).toEqual([
        409,
        'CART_SLOT_HAS_PEOPLE',
      ]);
      // An empty one planned by mistake goes.
      expect((await h.as('boss').delete(`/cart-slots/${s1b}`)).status).toBe(
        204,
      );
    });

    it('a place shifts were planned at is switched off, not deleted', async () => {
      const res = await h.as('boss').delete(`/cart-locations/${locB}`);
      expect(code(res)).toEqual([409, 'CART_LOCATION_IN_USE']);
      const said = await h.sql(
        `SELECT 1 FROM audit_logs WHERE entity_type = 'cart_location' AND action = 'DELETE' AND entity_id = $1`,
        [locB],
      );
      expect(said).toHaveLength(0);
      const unused = await h
        .as('boss')
        .post('/cart-locations', { name: 'Leer' });
      expect(
        (await h.as('boss').delete(`/cart-locations/${unused.body.id}`)).status,
      ).toBe(204);
    });

    it('the journal says who was put on which shift', async () => {
      // Through the entity: the journal's facts are kept encrypted.
      const rows = await h.db.getRepository(AuditLog).find({
        where: { entityType: 'cart_assignment', action: 'CREATE' },
      });
      const anna = rows.find((r) => r.subjectId === pid.anna)!;
      expect(JSON.parse(anna.afterJson!)).toMatchObject({
        place: 'Bahnhof',
        time: '10:00–12:00',
      });
    });
  });

  describe('time', () => {
    it('nobody signs up to a shift that has begun, nor gives back one that is over', async () => {
      const past = mondayIn(-2);
      const weekId = await build(past, [3], [locA]);
      await h.as('boss').post(`/cart-weeks/${weekId}/open`);
      const slot = (await view('boss', past)).slots[0].id;
      expect(
        code(await h.as('dan').post(`/cart-slots/${slot}/request`, {})),
      ).toEqual([400, 'CART_SLOT_PAST']);
      expect((await assign(slot, 'dan')).status).toBe(201);
      expect(
        code(await h.as('dan').delete(`/cart-slots/${slot}/my-assignment`)),
      ).toEqual([400, 'CART_SLOT_PAST']);
    });

    it('the evening before, the shift is in the digest — the hour, the place, the partner', async () => {
      // «Today» and «tomorrow» as the congregation counts them.
      const today = (
        await h.sql<{ d: string }>(
          `SELECT (now() AT TIME ZONE 'Europe/Berlin')::date::text AS d`,
        )
      )[0].d;
      const tomorrow = addDays(today, 1);
      const dow = ((new Date(`${tomorrow}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
      const monday = addDays(tomorrow, 1 - dow);
      const weekId = await build(monday, [dow], [locA], '16:00', '18:00');
      await h.as('boss').post(`/cart-weeks/${weekId}/open`);
      const slot = (await view('boss', monday)).slots.find(
        (s) => s.date === tomorrow,
      )!.id;
      await assign(slot, 'eva');
      await assign(slot, 'fedor');
      await h.as('boss').post(`/cart-weeks/${weekId}/publish`);

      const reminders = h.app.get(AssignmentRemindersService);
      await reminders.sendDigests(tenant, today);
      const eva = (
        await h.sql<{ body: string }>(
          `SELECT body FROM notification_outbox WHERE kind = 'assignment_reminder' AND user_id = $1`,
          [uid.eva],
        )
      ).map((r) => r.body);
      expect(eva.join('\n')).toContain(
        '16:00–18:00: стенд Bahnhof, вместе: Тест fedor',
      );
    });
  });

  it('«повторить прошлую неделю»: the same shifts, nobody on them', async () => {
    const from = mondayIn(6);
    await build(from, [2, 6], [locA, locB]);
    const target = mondayIn(7);
    // Markt is switched off since: it is not repeated.
    await h.as('boss').patch(`/cart-locations/${locB}`, { isActive: false });
    const res = await h
      .as('boss')
      .post('/cart-weeks/copy', { weekStartDate: target });
    expect(res.status).toBe(201);
    const v = await view('boss', target);
    expect(
      v.slots.map((s) => `${s.date}|${s.startTime}|${s.locationId}`).sort(),
    ).toEqual(
      [2, 6]
        .flatMap((d) =>
          ['10:00', '12:00'].map(
            (t) => `${addDays(target, d - 1)}|${t}|${locA}`,
          ),
        )
        .sort(),
    );
    expect(v.slots.every((s) => (s.assignments ?? []).length === 0)).toBe(true);
    // A second press adds nothing.
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
});
