import { Harness, startHarness } from './harness';
import { PioneerMeetingsService } from '../../src/pioneer-meetings/pioneer-meetings.service';

/**
 * The annual meeting of the elders with the pioneers (S-211), against a real
 * database: who may arrange it, who is invited, who hears of it, and the
 * body's task that closes itself.
 */
describe('the annual meeting with the pioneers (real database)', () => {
  let h: Harness;
  let elderCard: string;
  let pioneerCard: string;
  let auxCard: string;
  let otherElderCard: string;

  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const inDays = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return ymd(d);
  };

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

  it('only those who arrange it may; the conductor must be an elder', async () => {
    const body = {
      date: inDays(10),
      timeStart: '11:30',
      conductorPublisherId: elderCard,
    };
    const byElder = await h.as('keller').post('/pioneer-meetings', body);
    expect(byElder.status).toBe(403);
    const notElder = await h.as('admin').post('/pioneer-meetings', {
      ...body,
      conductorPublisherId: pioneerCard,
    });
    expect(notElder.body.code).toBe('PIONEER_MEETING_NOT_ELDER');
  });

  let meetingId: string;
  it('invites the pioneers of its day, tells them and the conductor', async () => {
    const r = await h.as('admin').post('/pioneer-meetings', {
      date: inDays(10),
      timeStart: '11:30',
      timeEnd: '12:30',
      place: 'Зал Царства',
      conductorPublisherId: elderCard,
    });
    expect(r.status).toBe(201);
    meetingId = r.body.id;
    expect(r.body.invited.map((p: { id: string }) => p.id)).toEqual([
      pioneerCard,
    ]);
    const sent = await h.sql<{ key: string; user_id: string }>(
      `SELECT dedupe_key AS key, user_id FROM notification_outbox WHERE dedupe_key LIKE $1`,
      [`pioneer-meeting:${meetingId}:%`],
    );
    const keys = sent.map((s) => s.key).join(' ');
    expect(keys).toContain(':created:i:');
    expect(keys).toContain(':created:c:');
    // Nobody else hears of it — the publisher who is not a pioneer, above all.
    expect(sent).toHaveLength(2);
  });

  it('is on Home for the invited and for the conductor, nobody else', async () => {
    const mine = async (who: string) =>
      (await h.as(who).get('/me/assignments')).body.items?.filter(
        (i: { kind: string }) => i.kind === 'pioneer_meeting',
      ) ?? [];
    expect((await mine('richter'))[0]).toMatchObject({
      label: 'invited',
      time: '11:30',
    });
    expect((await mine('weber'))[0]).toMatchObject({ label: 'conduct' });
    expect(await mine('lang')).toEqual([]);
  });

  it('the conductor reads his meeting with who is invited; a publisher does not', async () => {
    expect(
      (await h.as('weber').get(`/pioneer-meetings/${meetingId}`)).status,
    ).toBe(200);
    expect(
      (await h.as('richter').get(`/pioneer-meetings/${meetingId}`)).status,
    ).toBe(403);
    expect((await h.as('richter').get('/pioneer-meetings')).status).toBe(403);
  });

  it('a change of conductor tells the new elder and frees the old one', async () => {
    const r = await h.as('admin').patch(`/pioneer-meetings/${meetingId}`, {
      date: inDays(10),
      timeStart: '11:30',
      timeEnd: '12:30',
      place: 'Зал Царства',
      conductorPublisherId: otherElderCard,
    });
    expect(r.status).toBe(200);
    const keys = (
      await h.sql<{ key: string }>(
        `SELECT dedupe_key AS key FROM notification_outbox WHERE dedupe_key LIKE $1`,
        [`pioneer-meeting:${meetingId}:%`],
      )
    ).map((s) => s.key);
    expect(keys.some((k) => k.includes(':conductorFreed:'))).toBe(true);
    expect(keys.filter((k) => k.includes(':created:c:'))).toHaveLength(2);
  });

  it('the body’s task in November: raised, closed by the meeting, opened again when it goes', async () => {
    const svc = h.app.get(PioneerMeetingsService);
    const nov = new Date('2026-11-05T09:00:00Z');
    expect(await svc.ensureTasks(nov)).toBe(1);
    const task = async () =>
      (
        await h.sql<{ status: string }>(
          `SELECT status FROM elder_tasks WHERE kind = 'pioneer_meeting' AND kind_period = '2027'`,
        )
      )[0];
    expect((await task()).status).toBe('open');
    const set = await h.as('admin').post('/pioneer-meetings', {
      date: '2026-12-12',
      conductorPublisherId: elderCard,
    });
    expect((await task()).status).toBe('done');
    await h.as('admin').delete(`/pioneer-meetings/${set.body.id}`);
    expect((await task()).status).toBe('open');
    // Once offered, never raised twice.
    expect(await svc.ensureTasks(nov)).toBe(0);
  });
});
