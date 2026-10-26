import { Harness, startHarness } from './harness';
import { CongregationClock } from '../../src/common/congregation-clock.service';
import { TalkAttentionService } from '../../src/talk-exchange/talk-attention.service';

/**
 * Our own weekends (Lionel, 25 October 2026): the guest's opening song kept
 * on his visit and in the programme as one; the song the Watchtower study
 * sings the same day named at once; an empty weekend said 8 and 4 weeks
 * before; a guest without a lunch bag said 7 days before; the bringer told
 * the evening two days before; the coordinator reminded to remind the guest.
 */
describe('our weekends that need somebody (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let today: string;
  let attention: TalkAttentionService;
  let clock: CongregationClock;

  const plus = (iso: string, k: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
  };
  const monday = (iso: string): string =>
    plus(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
  /** The Monday `n` weeks after this week's. */
  const week = (n: number): string => plus(monday(today), 7 * n);

  const createWeek = async (
    w: string,
    songs: { opening?: string | null; study?: string; closing?: string } = {},
  ) => {
    const r = await h.as('admin').post('/assignments/bulk', {
      assignments: [
        {
          weekStartDate: w,
          eventType: 'weekend',
          partKey: 'public_talk_speaker',
        },
        {
          weekStartDate: w,
          eventType: 'weekend',
          partKey: 'weekend_opening_song',
          partOrder: 2,
          ...(songs.opening ? { partTitle: songs.opening } : {}),
        },
        {
          weekStartDate: w,
          eventType: 'weekend',
          partKey: 'weekend_song',
          partOrder: 5,
          partTitle: songs.study ?? 'Песня 12',
        },
        {
          weekStartDate: w,
          eventType: 'weekend',
          partKey: 'weekend_closing_prayer',
          partOrder: 8,
          partTitle: songs.closing ?? 'Песня 34 и молитва',
        },
      ],
    });
    expect(r.status).toBe(201);
  };
  const guest = async (w: string, first: string, body: object = {}) => {
    const card = await h
      .as('admin')
      .post('/visiting-speakers', { firstName: first, lastName: 'Гостев' });
    expect(card.status).toBe(201);
    const r = await h.as('admin').post('/talk-exchange', {
      direction: 'incoming',
      date: plus(w, 6),
      visitingSpeakerId: card.body.id,
      ...body,
    });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const songLine = async (w: string) =>
    (
      await h.sql<{ id: string; title: string | null }>(
        `SELECT id, part_title AS title FROM assignments
          WHERE week_start_date = $1 AND part_key = 'weekend_opening_song'
            AND deleted_at IS NULL`,
        [w],
      )
    )[0];
  const songOf = async (id: string) =>
    (
      await h.sql<{ song: number | null }>(
        `SELECT opening_song AS song FROM talk_exchange WHERE id = $1`,
        [id],
      )
    )[0].song;
  const told = async (key: string) =>
    (
      await h.sql<{ n: number }>(
        `SELECT count(DISTINCT dedupe_key)::int AS n FROM notification_outbox
          WHERE dedupe_key LIKE $1`,
        [`${key}%`],
      )
    )[0].n;
  const listed = async () => {
    const r = await h.as('admin').get('/talk-exchange/attention/incoming');
    expect(r.status).toBe(200);
    return r.body as {
      reason: string;
      weekStartDate: string;
      entryId: string | null;
      song: number | null;
      studySongs: number[];
    }[];
  };
  const asOf = async <T>(day: string, run: () => Promise<T>): Promise<T> => {
    const spy = jest.spyOn(clock, 'todayFor').mockResolvedValue(day);
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  };

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    clock = h.app.get(CongregationClock);
    attention = h.app.get(TalkAttentionService);
    today = await clock.todayFor(tenantId);
  });
  afterAll(async () => {
    await h?.close();
  });

  it("the guest's song goes into the programme, comes back from it, and leaves with the visit", async () => {
    const w = week(12);
    await createWeek(w);
    const g = await guest(w, 'Пётр', { openingSong: 45 });
    expect((await songLine(w)).title).toBe('Песня 45');
    await h.as('admin').patch(`/talk-exchange/${g}`, { openingSong: 50 });
    expect((await songLine(w)).title).toBe('Песня 50');
    const line = await songLine(w);
    const r = await h
      .as('admin')
      .patch(`/assignments/${line.id}`, { partTitle: 'Песня 60' });
    expect(r.status).toBe(200);
    expect(await songOf(g)).toBe(60);
    await h.as('admin').delete(`/talk-exchange/${g}`);
    expect((await songLine(w)).title).toBeNull();
  });

  it("a visit learns the programme's song, and taking it off the visit clears both", async () => {
    const w = week(13);
    await createWeek(w, { opening: 'Песня 70' });
    const g = await guest(w, 'Павел');
    // The visit learns the song the programme already holds.
    expect(await songOf(g)).toBe(70);
    await h.as('admin').patch(`/talk-exchange/${g}`, { openingSong: 71 });
    expect((await songLine(w)).title).toBe('Песня 71');
    await h.as('admin').patch(`/talk-exchange/${g}`, { openingSong: null });
    expect((await songLine(w)).title).toBeNull();
  });

  it('a week made after the visit takes its song', async () => {
    const w = week(14);
    await guest(w, 'Семён', { openingSong: 77 });
    await createWeek(w);
    expect((await songLine(w)).title).toBe('Песня 77');
  });

  it("the study's song is named at once and listed — never in a circuit visit week", async () => {
    const w = week(15);
    await createWeek(w);
    const g = await guest(w, 'Глеб', { openingSong: 12 });
    const items = (await listed()).filter((i) => i.weekStartDate === w);
    expect(items).toEqual([
      expect.objectContaining({
        reason: 'song_repeat',
        entryId: g,
        song: 12,
        studySongs: [12, 34],
      }),
    ]);
    expect(await told(`talk-attention:song:${w}:12`)).toBe(1);
    await h.as('admin').patch(`/talk-exchange/${g}`, { openingSong: 13 });
    expect((await listed()).filter((i) => i.weekStartDate === w)).toEqual([]);

    const co = week(16);
    await createWeek(co, { opening: 'Песня 12' });
    const v = await h.as('admin').post('/special-events', {
      title: 'Визит районного',
      type: 'circuit_overseer_visit',
      date: plus(co, 1),
      coFirstName: 'Андреас',
      coLastName: 'Районный',
    });
    expect(v.status).toBe(201);
    expect((await listed()).filter((i) => i.weekStartDate === co)).toEqual([]);
  });

  it('an empty weekend is listed from 8 weeks and said at 8 and at 4', async () => {
    const near = week(3);
    const far = week(7);
    const items = await listed();
    const of = (w: string) =>
      items.filter((i) => i.weekStartDate === w).map((i) => i.reason);
    expect(of(near)).toEqual(['needs_guest']);
    expect(of(far)).toEqual(['needs_guest']);
    expect(of(week(10))).toEqual([]);
    await attention.runFor(tenantId);
    await attention.runFor(tenantId);
    expect(await told(`talk-attention:guest:${near}:28`)).toBe(1);
    expect(await told(`talk-attention:guest:${far}:56`)).toBe(1);
    // Booked: no longer empty.
    await guest(far, 'Фома');
    expect((await listed()).filter((i) => i.weekStartDate === far)).toEqual([]);
  });

  it('no lunch bag: listed from 14 days, said at 7; the bringer hears two days before; the coordinator is reminded to remind', async () => {
    const w = week(5);
    const g = await guest(w, 'Лука');
    const sunday = plus(w, 6);
    // Fourteen days before: listed, not said.
    await asOf(plus(sunday, -14), async () => {
      const items = (await attention.incomingAttention(tenantId)).filter(
        (i) => i.weekStartDate === w,
      );
      expect(items.map((i) => i.reason)).toEqual(['no_lunch']);
      await attention.runFor(tenantId);
    });
    expect(await told(`talk-attention:lunch:${g}`)).toBe(0);
    await asOf(plus(sunday, -7), () => attention.runFor(tenantId));
    expect(await told(`talk-attention:lunch:${g}`)).toBe(1);

    // Somebody brings one: it leaves the list.
    const bringer = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Пакетова',
      gender: 'sister',
    });
    const uid = await h.addUser({
      login: 'bringer',
      role: 'publisher',
      publisherId: bringer,
    });
    await h
      .as('admin')
      .patch(`/talk-exchange/${g}`, { hospitalityPublisherId: bringer });
    await asOf(plus(sunday, -7), async () => {
      const items = (await attention.incomingAttention(tenantId)).filter(
        (i) => i.weekStartDate === w,
      );
      expect(items).toEqual([]);
    });

    // The evening two days before: the bringer herself.
    expect(
      await asOf(plus(sunday, -3), () => attention.lunchBagFor(tenantId)),
    ).toBe(0);
    expect(
      await asOf(plus(sunday, -2), () => attention.lunchBagFor(tenantId)),
    ).toBe(1);
    const [bag] = await h.sql<{ user_id: string; title: string }>(
      `SELECT user_id, title FROM notification_outbox WHERE dedupe_key LIKE $1`,
      [`guest-lunch:${g}%`],
    );
    expect(bag.user_id).toBe(uid);

    // «Напомните гостю»: three days before, not for a visit just made.
    await asOf(plus(sunday, -3), () => attention.runFor(tenantId));
    expect(await told(`talk-attention:remind:${g}`)).toBe(0);
    await h.sql(
      `UPDATE talk_exchange SET created_at = now() - interval '20 days' WHERE id = $1`,
      [g],
    );
    await asOf(plus(sunday, -3), () => attention.runFor(tenantId));
    await asOf(plus(sunday, -3), () => attention.runFor(tenantId));
    expect(await told(`talk-attention:remind:${g}`)).toBe(1);
  });

  it('the weekend songs ahead are given for the message to the guest', async () => {
    const w = week(18);
    await createWeek(w, { study: 'Песня 101', closing: 'Песня 102 и молитва' });
    const r = await h.as('admin').get('/talk-exchange/week-songs');
    expect(r.status).toBe(200);
    expect(r.body).toEqual(
      expect.arrayContaining([
        { weekStartDate: w, opening: null, study: [101, 102] },
      ]),
    );
  });
});
