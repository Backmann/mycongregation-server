import { Harness, startHarness } from './harness';
import { PioneerMeetingsService } from '../../src/pioneer-meetings/pioneer-meetings.service';

/**
 * The annual meeting of the elders with the pioneers (S-211), against a real
 * database: who may arrange it, who conducts it (one or two, an elder or a
 * ministerial servant, or a name written by hand — 9 November 2026), who is
 * invited, who hears of it, once a season in December or January, history
 * kept, and the body's task that closes itself.
 *
 * Every day here is in a coming season, counted from today, so the file does
 * not go stale: «season(n)» is December of this year + n.
 */
describe('the annual meeting with the pioneers (real database)', () => {
  let h: Harness;
  let elderCard: string;
  let pioneerCard: string;
  let auxCard: string;
  let otherElderCard: string;
  let servantCard: string;
  let pioneerElderCard: string;
  let goneCard: string;

  const year = new Date().getUTCFullYear();
  /** A day in December of this year + n (season n). */
  const dec = (n: number, d = 12) =>
    `${year + n}-12-${String(d).padStart(2, '0')}`;
  /** A day in the January after it. */
  const jan = (n: number, d = 16) =>
    `${year + n + 1}-01-${String(d).padStart(2, '0')}`;

  /**
   * The nearest coming day of a season — within the year Home looks ahead,
   * and after today, so it is told and shown.
   */
  const today = new Date().toISOString().slice(0, 10);
  const soon = [`${year}-01-20`, `${year}-12-12`, `${year + 1}-01-20`].find(
    (d) => d > today,
  )!;

  const keysOf = async (id: string) =>
    (
      await h.sql<{ key: string; user_id: string }>(
        `SELECT dedupe_key AS key, user_id FROM notification_outbox WHERE dedupe_key LIKE $1`,
        [`pioneer-meeting:${id}:%`],
      )
    ).map((r) => r.key);
  const mine = async (who: string) =>
    (
      (await h.as(who).get('/me/assignments')).body.items as {
        kind: string;
        label?: string;
        partnerName?: string;
        partnerNames?: string[];
        time?: string;
      }[]
    ).filter((i) => i.kind === 'pioneer_meeting');

  beforeAll(async () => {
    h = await startHarness();
    elderCard = await h.addPublisher({
      firstName: 'Андреас',
      lastName: 'Вебер',
      appointment: 'elder',
      baptismDate: '1990-01-01',
    });
    await h.addUser({ login: 'weber', role: 'elder', publisherId: elderCard });
    otherElderCard = await h.addPublisher({
      firstName: 'Давид',
      lastName: 'Келлер',
      appointment: 'elder',
      baptismDate: '1990-01-01',
    });
    await h.addUser({
      login: 'keller',
      role: 'elder',
      publisherId: otherElderCard,
    });
    servantCard = await h.addPublisher({
      firstName: 'Тимо',
      lastName: 'Ланг',
      appointment: 'ministerial_servant',
      baptismDate: '1995-01-01',
    });
    await h.addUser({
      login: 'timo',
      role: 'publisher',
      publisherId: servantCard,
    });
    pioneerElderCard = await h.addPublisher({
      firstName: 'Маркус',
      lastName: 'Фогт',
      appointment: 'elder',
      baptismDate: '1990-01-01',
      pioneerType: 'regular',
      pioneerSince: '2015-09-01',
    });
    await h.addUser({
      login: 'vogt',
      role: 'elder',
      publisherId: pioneerElderCard,
    });
    pioneerCard = await h.addPublisher({
      firstName: 'Мария',
      lastName: 'Рихтер',
      gender: 'sister',
      baptismDate: '2000-01-01',
      pioneerType: 'regular',
      pioneerSince: '2015-09-01',
    });
    await h.addUser({
      login: 'richter',
      role: 'publisher',
      publisherId: pioneerCard,
    });
    goneCard = await h.addPublisher({
      firstName: 'Ушла',
      lastName: 'Давно',
      gender: 'sister',
      baptismDate: '2000-01-01',
      pioneerType: 'regular',
      pioneerSince: '2015-09-01',
    });
    await h.sql(`UPDATE publishers SET removed_at = now() WHERE id = $1`, [
      goneCard,
    ]);
    auxCard = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Ланг',
      gender: 'sister',
      baptismDate: '2000-01-01',
    });
    await h.addUser({ login: 'lang', role: 'publisher', publisherId: auxCard });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('only those who arrange it may; a publisher may not conduct it', async () => {
    const body = {
      date: soon,
      timeStart: '11:30',
      conductors: [{ publisherId: elderCard }],
    };
    const byElder = await h.as('keller').post('/pioneer-meetings', body);
    expect(byElder.status).toBe(403);
    const notAppointed = await h.as('admin').post('/pioneer-meetings', {
      ...body,
      conductors: [{ publisherId: pioneerCard }],
    });
    expect(notAppointed.body.code).toBe('PIONEER_MEETING_NOT_APPOINTED');
    const nobody = await h.as('admin').post('/pioneer-meetings', {
      ...body,
      conductors: [{ publisherId: null, name: '   ' }],
    });
    expect(nobody.body.code).toBe('PIONEER_MEETING_NO_CONDUCTOR');
    const twice = await h.as('admin').post('/pioneer-meetings', {
      ...body,
      conductors: [{ publisherId: elderCard }, { publisherId: elderCard }],
    });
    expect(twice.body.code).toBe('PIONEER_MEETING_SAME_CONDUCTOR');
    const sameName = await h.as('admin').post('/pioneer-meetings', {
      ...body,
      conductors: [{ name: 'Иван  Петров' }, { name: 'иван петров' }],
    });
    expect(sameName.body.code).toBe('PIONEER_MEETING_SAME_CONDUCTOR');
    // Nothing of these was kept.
    expect(
      await h.sql(`SELECT 1 FROM pioneer_meetings WHERE deleted_at IS NULL`),
    ).toHaveLength(0);
  });

  it('in December or January only, and once a season', async () => {
    const nov = await h.as('admin').post('/pioneer-meetings', {
      date: `${year + 1}-11-28`,
      conductors: [{ publisherId: elderCard }],
    });
    expect(nov.body.code).toBe('PIONEER_MEETING_OUT_OF_SEASON');
    const feb = await h.as('admin').post('/pioneer-meetings', {
      date: `${year + 2}-02-01`,
      conductors: [{ publisherId: elderCard }],
    });
    expect(feb.body.code).toBe('PIONEER_MEETING_OUT_OF_SEASON');
    const first = await h.as('admin').post('/pioneer-meetings', {
      date: dec(3),
      conductors: [{ publisherId: elderCard }],
    });
    expect(first.status).toBe(201);
    // January of the same season: taken, and said by which day.
    const second = await h.as('admin').post('/pioneer-meetings', {
      date: jan(3),
      conductors: [{ publisherId: otherElderCard }],
    });
    expect(second.body.code).toBe('PIONEER_MEETING_SEASON_TAKEN');
    expect(JSON.stringify(second.body)).toContain(dec(3));
    // Moving it within its own season is no clash with itself.
    const moved = await h
      .as('admin')
      .patch(`/pioneer-meetings/${first.body.id}`, {
        date: jan(3),
        conductors: [{ publisherId: elderCard }],
      });
    expect(moved.status).toBe(200);
    // Reverse: the next season is free.
    const next = await h.as('admin').post('/pioneer-meetings', {
      date: dec(4),
      conductors: [{ publisherId: elderCard }],
    });
    expect(next.status).toBe(201);
    await h.sql(`DELETE FROM pioneer_meetings`);
  });

  let meetingId: string;
  it('two conduct it: each told with the other named; the pioneers told who', async () => {
    const r = await h.as('admin').post('/pioneer-meetings', {
      date: soon,
      timeStart: '11:30',
      timeEnd: '12:30',
      place: 'Зал Царства',
      conductors: [
        { publisherId: elderCard },
        { publisherId: pioneerElderCard },
      ],
    });
    expect(r.status).toBe(201);
    meetingId = r.body.id;
    expect(r.body.conductors).toEqual([
      { id: elderCard, name: 'Вебер Андреас', appointment: 'elder' },
      { id: pioneerElderCard, name: 'Фогт Маркус', appointment: 'elder' },
    ]);
    // The old app's one conductor is the first one.
    expect(r.body.conductor).toEqual({ id: elderCard, name: 'Вебер Андреас' });
    // Invited: the pioneers — not the one conducting it, though he pioneers,
    // and not the one who left.
    expect(r.body.invited.map((p: { id: string }) => p.id)).toEqual([
      pioneerCard,
    ]);
    const keys = await keysOf(meetingId);
    expect(keys.filter((k) => k.includes(':created:i:'))).toHaveLength(1);
    expect(keys.filter((k) => k.includes(':created:c:'))).toHaveLength(2);
    const said = await h.sql<{ user_id: string; body: string }>(
      `SELECT user_id, body FROM notification_outbox WHERE dedupe_key LIKE $1`,
      [`pioneer-meeting:${meetingId}:created:%`],
    );
    expect(said.map((s) => s.body).join(' | ')).toContain(
      'Проводят Вебер Андреас и Фогт Маркус.',
    );
    expect(said.map((s) => s.body).join(' | ')).toContain(
      'Второй проводящий — Фогт Маркус.',
    );
    expect(said.map((s) => s.body).join(' | ')).toContain(
      'Второй проводящий — Вебер Андреас.',
    );
  });

  it('the list counts whom the meeting lists', async () => {
    const list = await h.as('keller').get('/pioneer-meetings');
    const row = list.body.meetings.find(
      (m: { id: string }) => m.id === meetingId,
    );
    // Rihter only: neither the conducting pioneer nor the one who left.
    expect(row.invitedCount).toBe(1);
    expect(row.conductors.map((c: { name: string }) => c.name)).toEqual([
      'Вебер Андреас',
      'Фогт Маркус',
    ]);
  });

  it('on Home: each conductor with the other; the pioneer with both; nobody else', async () => {
    expect((await mine('richter'))[0]).toMatchObject({
      label: 'invited',
      time: '11:30',
      partnerNames: ['Вебер Андреас', 'Фогт Маркус'],
    });
    expect((await mine('weber'))[0]).toMatchObject({
      label: 'conduct',
      partnerNames: ['Фогт Маркус'],
    });
    expect(await mine('vogt')).toHaveLength(1);
    expect((await mine('vogt'))[0]).toMatchObject({
      label: 'conduct',
      partnerNames: ['Вебер Андреас'],
    });
    expect(await mine('lang')).toEqual([]);
    // The calendar too, in its own order of names.
    const agendaOf = async (who: string) =>
      (
        (await h.as(who).get('/me/agenda')).body.items as {
          kind: string;
          with: string[];
          title: string;
        }[]
      ).filter((i) => i.kind === 'pioneer_meeting');
    expect((await agendaOf('vogt'))[0].with).toEqual(['Андреас Вебер']);
    expect((await agendaOf('richter'))[0].with).toEqual([
      'Андреас Вебер',
      'Маркус Фогт',
    ]);
    expect(await agendaOf('lang')).toEqual([]);
  });

  it('each conductor reads it with who is invited; a publisher does not', async () => {
    expect(
      (await h.as('weber').get(`/pioneer-meetings/${meetingId}`)).status,
    ).toBe(200);
    expect(
      (await h.as('vogt').get(`/pioneer-meetings/${meetingId}`)).status,
    ).toBe(200);
    expect(
      (await h.as('richter').get(`/pioneer-meetings/${meetingId}`)).status,
    ).toBe(403);
    expect((await h.as('richter').get('/pioneer-meetings')).status).toBe(403);
  });

  it('the second place changed: the new one told, the freed one told, the first one not', async () => {
    const before = (await keysOf(meetingId)).length;
    const r = await h.as('admin').patch(`/pioneer-meetings/${meetingId}`, {
      date: soon,
      timeStart: '11:30',
      timeEnd: '12:30',
      place: 'Зал Царства',
      conductors: [{ publisherId: elderCard }, { publisherId: servantCard }],
    });
    expect(r.status).toBe(200);
    // A ministerial servant may conduct it.
    expect(r.body.conductors[1]).toMatchObject({
      id: servantCard,
      appointment: 'ministerial_servant',
    });
    const rows = await h.sql<{ key: string; user_id: string }>(
      `SELECT dedupe_key AS key, u.login_name AS user_id FROM notification_outbox o
         JOIN users u ON u.id = o.user_id WHERE dedupe_key LIKE $1
        ORDER BY o.created_at`,
      [`pioneer-meeting:${meetingId}:%`],
    );
    const fresh = rows.slice(before);
    expect(
      fresh.map((x) => `${x.user_id} ${x.key.split(':')[2]}`).sort(),
    ).toEqual(['timo created', 'vogt conductorFreed']);
    // Now that he no longer conducts it, the pioneering elder is invited.
    expect(r.body.invited.map((p: { id: string }) => p.id).sort()).toEqual(
      [pioneerCard, pioneerElderCard].sort(),
    );
  });

  it('a name written by hand: kept, shown, nobody to notify', async () => {
    const r = await h.as('admin').patch(`/pioneer-meetings/${meetingId}`, {
      date: soon,
      timeStart: '11:30',
      timeEnd: '12:30',
      place: 'Зал Царства',
      conductors: [
        { publisherId: elderCard },
        { publisherId: null, name: '  Гость   Старейшина ' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.conductors[1]).toEqual({
      id: null,
      name: 'Гость Старейшина',
      appointment: null,
    });
    expect((await mine('richter'))[0].partnerNames).toEqual([
      'Вебер Андреас',
      'Гость Старейшина',
    ]);
    expect((await mine('weber'))[0].partnerNames).toEqual(['Гость Старейшина']);
    // Alone by hand, too: the first place may be a written name.
    const solo = await h.as('admin').patch(`/pioneer-meetings/${meetingId}`, {
      date: soon,
      timeStart: '11:30',
      conductors: [{ name: 'Гость Старейшина' }],
    });
    expect(solo.status).toBe(200);
    expect(solo.body.conductor).toEqual({ id: '', name: 'Гость Старейшина' });
    expect(await mine('weber')).toEqual([]);
  });

  it('the old app sends one elder: the second place is kept as it was', async () => {
    await h.as('admin').patch(`/pioneer-meetings/${meetingId}`, {
      date: soon,
      timeStart: '11:30',
      conductors: [{ publisherId: elderCard }, { publisherId: otherElderCard }],
    });
    const old = await h.as('admin').patch(`/pioneer-meetings/${meetingId}`, {
      date: soon,
      timeStart: '12:00',
      conductorPublisherId: elderCard,
    });
    expect(old.status).toBe(200);
    expect(old.body.conductors.map((c: { id: string }) => c.id)).toEqual([
      elderCard,
      otherElderCard,
    ]);
  });

  it('a week before: the conductors are reminded, the pioneers are not', async () => {
    const svc = h.app.get(PioneerMeetingsService);
    const weekBefore = new Date(`${soon}T19:00:00Z`);
    weekBefore.setUTCDate(weekBefore.getUTCDate() - 7);
    await svc.remindEvening(weekBefore);
    const rows = await h.sql<{ who: string }>(
      `SELECT u.login_name AS who FROM notification_outbox o JOIN users u ON u.id = o.user_id
        WHERE dedupe_key LIKE $1`,
      [`pioneer-meeting:${meetingId}:reminderWeek:%`],
    );
    expect(rows.map((r) => r.who).sort()).toEqual(['keller', 'weber']);
  });

  it('a meeting that has taken place is kept as it was', async () => {
    const past = `${year - 2}-12-10`;
    const r = await h.as('admin').post('/pioneer-meetings', {
      date: past,
      conductors: [{ publisherId: elderCard }],
    });
    expect(r.status).toBe(201);
    const change = await h.as('admin').patch(`/pioneer-meetings/${r.body.id}`, {
      date: past,
      conductors: [{ publisherId: otherElderCard }],
    });
    expect(change.body.code).toBe('PIONEER_MEETING_PAST_LOCKED');
    const gone = await h.as('admin').delete(`/pioneer-meetings/${r.body.id}`);
    expect(gone.body.code).toBe('PIONEER_MEETING_PAST_LOCKED');
    // Reverse: a coming one may still be changed (above) and cancelled.
    expect(
      (await h.as('admin').delete(`/pioneer-meetings/${meetingId}`)).status,
    ).toBe(200);
  });

  it('the body’s task in November: raised, closed by the meeting, opened again when it goes', async () => {
    const svc = h.app.get(PioneerMeetingsService);
    const nov = new Date(`${year + 5}-11-05T09:00:00Z`);
    const period = String(year + 6);
    expect(await svc.ensureTasks(nov)).toBe(1);
    const task = async () =>
      (
        await h.sql<{ status: string }>(
          `SELECT status FROM elder_tasks WHERE kind = 'pioneer_meeting' AND kind_period = $1`,
          [period],
        )
      )[0];
    expect((await task()).status).toBe('open');
    const set = await h.as('admin').post('/pioneer-meetings', {
      date: dec(5),
      conductors: [{ publisherId: elderCard }],
    });
    expect(set.status).toBe(201);
    expect((await task()).status).toBe('done');
    await h.as('admin').delete(`/pioneer-meetings/${set.body.id}`);
    expect((await task()).status).toBe('open');
    // Once offered, never raised twice.
    expect(await svc.ensureTasks(nov)).toBe(0);
  });
});
