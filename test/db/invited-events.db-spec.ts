import { Harness, startHarness } from './harness';

/**
 * Events for the invited only (10 November 2026): the Kingdom Ministry
 * School for elders and for ministerial servants, and the special meeting
 * with the pioneers of the circuit. Only the invited see them, are told and
 * find them in their agenda; those who keep events see them with a count;
 * planners learn only who is busy when; the kind does not change.
 *
 * Dates in 2099, far ahead of any clock.
 */
describe('events for the invited only (real database)', () => {
  let h: Harness;
  let elder = '';
  let servant = '';
  let pioneer = ''; // regular pioneer since 2020
  let missionary = '';
  let laterPioneer = ''; // a pioneer only from after the event
  let sister = '';

  const create = (body: Record<string, unknown>) =>
    h.as('admin').post('/special-events', body);
  const listOf = async (who: string) => {
    const r = await h.as(who).get('/special-events');
    expect(r.status).toBe(200);
    return (r.body as { id: string; invitedCount?: number }[]).map((e) => e);
  };
  const ids = async (who: string) => (await listOf(who)).map((e) => e.id);
  const toldTo = async (eventId: string) =>
    (
      await h.sql<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM notification_outbox WHERE dedupe_key LIKE $1`,
        [`event:${eventId}:%`],
      )
    ).map((r) => r.user_id);
  const users: Record<string, string> = {};
  const userOf = async (login: string) => Promise.resolve(users[login]);

  beforeAll(async () => {
    h = await startHarness();
    const add = async (
      firstName: string,
      gender: 'brother' | 'sister',
      sets: string,
    ) => {
      const id = await h.addPublisher({
        firstName,
        lastName: 'Тест',
        gender,
        baptismDate: '2001-01-01',
      });
      if (sets)
        await h.sql(`UPDATE publishers SET ${sets} WHERE id = $1`, [id]);
      return id;
    };
    elder = await add('Пётр', 'brother', `appointment = 'elder'`);
    servant = await add(
      'Павел',
      'brother',
      `appointment = 'ministerial_servant'`,
    );
    pioneer = await add(
      'Анна',
      'sister',
      `pioneer_type = 'regular', pioneer_since = '2020-09-01'`,
    );
    missionary = await add('Мария', 'sister', `pioneer_type = 'missionary'`);
    laterPioneer = await add(
      'Ирина',
      'sister',
      `pioneer_type = 'regular', pioneer_since = '2099-09-01'`,
    );
    sister = await add('Вера', 'sister', '');
    users['elder'] = await h.addUser({
      login: 'elder',
      role: 'elder',
      publisherId: elder,
    });
    users['servant'] = await h.addUser({
      login: 'servant',
      role: 'ministerial_servant',
      publisherId: servant,
    });
    users['pioneer'] = await h.addUser({
      login: 'pioneer',
      role: 'publisher',
      publisherId: pioneer,
    });
    users['missionary'] = await h.addUser({
      login: 'missionary',
      role: 'publisher',
      publisherId: missionary,
    });
    users['later'] = await h.addUser({
      login: 'later',
      role: 'publisher',
      publisherId: laterPioneer,
    });
    users['sister'] = await h.addUser({
      login: 'sister',
      role: 'publisher',
      publisherId: sister,
    });
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    await h.sql(`DELETE FROM notification_outbox`);
    await h.sql(`DELETE FROM special_events`);
  });

  it('the school for elders: seen and told only by the elders; the keeper sees it with a count', async () => {
    const r = await create({
      title: 'Школа царственного служения для старейшин',
      type: 'kingdom_ministry_school_elders',
      date: '2099-02-07',
      endDate: '2099-02-08',
      time: '09:30',
      timeEnd: '16:00',
      address: 'Зал конгрессов',
    });
    expect(r.status).toBe(201);
    const id = (r.body as { id: string }).id;

    expect(await ids('elder')).toContain(id);
    for (const who of ['servant', 'pioneer', 'sister']) {
      expect(await ids(who)).not.toContain(id);
      expect((await h.as(who).get(`/special-events/${id}`)).status).toBe(404);
    }
    expect((await h.as('elder').get(`/special-events/${id}`)).status).toBe(200);
    const kept = (await listOf('admin')).find((e) => e.id === id);
    expect(kept?.invitedCount).toBe(1);

    expect(await toldTo(id)).toEqual([await userOf('elder')]);
  });

  it('the school for ministerial servants: the servants only', async () => {
    const r = await create({
      title: 'Школа для служебных помощников',
      type: 'kingdom_ministry_school_servants',
      date: '2099-03-07',
    });
    const id = (r.body as { id: string }).id;
    expect(await ids('servant')).toContain(id);
    expect(await ids('elder')).not.toContain(id);
    expect(await toldTo(id)).toEqual([await userOf('servant')]);
  });

  it('the pioneers’ meeting: regular, special pioneers and missionaries on its day — not one who starts later', async () => {
    const r = await create({
      title: 'Специальная встреча с пионерами района',
      type: 'pioneer_special_meeting',
      date: '2099-01-17',
    });
    const id = (r.body as { id: string }).id;
    expect(await ids('pioneer')).toContain(id);
    expect(await ids('missionary')).toContain(id);
    expect(await ids('later')).not.toContain(id);
    expect(await ids('sister')).not.toContain(id);
    expect((await toldTo(id)).sort()).toEqual(
      [await userOf('pioneer'), await userOf('missionary')].sort(),
    );
  });

  it('an event for everybody is still everybody’s', async () => {
    const r = await create({
      title: 'Региональный конгресс',
      type: 'regional_convention',
      date: '2099-06-20',
    });
    const id = (r.body as { id: string }).id;
    for (const who of ['elder', 'sister', 'pioneer']) {
      expect(await ids(who)).toContain(id);
    }
  });

  it('the kind of an event for the invited does not change, nor becomes one', async () => {
    const school = (
      await create({
        title: 'Школа',
        type: 'kingdom_ministry_school_elders',
        date: '2099-02-07',
      })
    ).body as { id: string };
    const r = await h.as('admin').patch(`/special-events/${school.id}`, {
      type: 'kingdom_ministry_school_servants',
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('EVENT_TYPE_LOCKED');

    const other = (
      await create({ title: 'Другое', type: 'other', date: '2099-02-14' })
    ).body as { id: string };
    const r2 = await h.as('admin').patch(`/special-events/${other.id}`, {
      type: 'kingdom_ministry_school_elders',
    });
    expect(r2.status).toBe(400);
    expect(r2.body.code).toBe('EVENT_TYPE_LOCKED');
    // Its note can still be changed.
    const r3 = await h
      .as('admin')
      .patch(`/special-events/${school.id}`, { note: 'с 09:00 регистрация' });
    expect(r3.status).toBe(200);
  });

  it('planners learn who is busy and when — not the event; others learn nothing', async () => {
    await create({
      title: 'Школа',
      type: 'kingdom_ministry_school_elders',
      date: '2099-02-07',
      endDate: '2099-02-08',
      address: 'Зал конгрессов',
    });
    const r = await h
      .as('servant')
      .get('/special-events/busy?from=2099-02-01&to=2099-02-28');
    // A ministerial servant with no responsibility is no planner.
    expect(r.body).toEqual([]);
    const e = await h
      .as('elder')
      .get('/special-events/busy?from=2099-02-01&to=2099-02-28');
    expect(e.status).toBe(200);
    expect(e.body).toEqual([
      {
        publisherId: elder,
        date: '2099-02-07',
        endDate: '2099-02-08',
        type: 'kingdom_ministry_school_elders',
      },
    ]);
    const out = await h
      .as('elder')
      .get('/special-events/busy?from=2099-03-01&to=2099-03-31');
    expect(out.body).toEqual([]);
  });

  it('the field-service planner counts the invited as away on those days', async () => {
    await h.sql(
      `UPDATE publishers SET capabilities = '{"fs_meeting_conductor": true}'::jsonb WHERE id = ANY($1)`,
      [[elder, servant]],
    );
    await create({
      title: 'Школа',
      type: 'kingdom_ministry_school_elders',
      date: '2099-02-07',
    });
    const r = await h
      .as('admin')
      .get('/field-service-meetings/suggest-conductor?date=2099-02-07');
    expect(r.status).toBe(200);
    const by = new Map(
      (r.body as { publisherId: string; reason: string }[]).map((c) => [
        c.publisherId,
        c.reason,
      ]),
    );
    expect(by.get(elder)).toBe('absent');
    expect(by.get(servant)).not.toBe('absent');
    // A day later the elder is free again.
    const next = await h
      .as('admin')
      .get('/field-service-meetings/suggest-conductor?date=2099-02-08');
    expect(
      (next.body as { publisherId: string; reason: string }[]).find(
        (c) => c.publisherId === elder,
      )?.reason,
    ).not.toBe('absent');
  });

  it('in the invited’s own agenda, as theirs; not in anyone else’s', async () => {
    const id = (
      (
        await create({
          title: 'Школа',
          type: 'kingdom_ministry_school_elders',
          date: '2099-02-07',
          time: '09:30',
        })
      ).body as { id: string }
    ).id;
    const mine = await h
      .as('elder')
      .get('/me/agenda?from=2099-02-01&to=2099-02-28');
    expect(mine.status).toBe(200);
    const item = (
      mine.body.items as { id: string; scope: string; start: string }[]
    ).find((i) => i.id === `event:${id}`);
    expect(item).toMatchObject({ scope: 'mine', start: '09:30' });
    const theirs = await h
      .as('sister')
      .get('/me/agenda?from=2099-02-01&to=2099-02-28');
    expect(
      (theirs.body.items as { id: string }[]).some(
        (i) => i.id === `event:${id}`,
      ),
    ).toBe(false);
  });
});
