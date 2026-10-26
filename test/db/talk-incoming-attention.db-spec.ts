import { Harness, startHarness } from './harness';
import { CongregationClock } from '../../src/common/congregation-clock.service';
import { TalkAttentionService } from '../../src/talk-exchange/talk-attention.service';

/**
 * Our own weekends (Lionel, 25–26 October 2026): the guest's opening song
 * kept on his visit and in the programme as one; the song the Watchtower
 * study sings the same day named at once; everything else still to do —
 * empty weekends, a talk not chosen, a song not known, a lunch bag nobody
 * brings, this week's guests to remind — counted into one weekly summary;
 * the bringer told the evening two days before.
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
  /** The week's summary sent on `day` — its body, or null. */
  const digestOn = async (day: string) =>
    (
      await h.sql<{ body: string }>(
        `SELECT body FROM notification_outbox WHERE dedupe_key = $1 LIMIT 1`,
        [`talk-attention:digest:${monday(day)}`],
      )
    )[0]?.body ?? null;
  const digestCount = async () =>
    (
      await h.sql<{ n: number }>(
        `SELECT count(DISTINCT dedupe_key)::int AS n FROM notification_outbox
          WHERE dedupe_key LIKE 'talk-attention:digest:%'`,
      )
    )[0].n;
  const clearDigests = () =>
    h.sql(
      `DELETE FROM notification_outbox WHERE dedupe_key LIKE 'talk-attention:digest:%'`,
    );
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

  it('empty weekends are listed from 8 weeks and counted in ONE weekly summary', async () => {
    const near = week(3);
    const far = week(7);
    const items = await listed();
    const of = (w: string) =>
      items.filter((i) => i.weekStartDate === w).map((i) => i.reason);
    expect(of(near)).toEqual(['needs_guest']);
    expect(of(far)).toEqual(['needs_guest']);
    expect(of(week(10))).toEqual([]);
    await clearDigests();
    await attention.runFor(tenantId);
    await attention.runFor(tenantId);
    // Neither weekend has a notice of its own; one summary counts both.
    expect(await told('talk-attention:guest:')).toBe(0);
    expect(await digestCount()).toBe(1);
    const empty = items.filter((i) => i.reason === 'needs_guest').length;
    expect(await digestOn(today)).toContain(`«К нам»: ${empty}`);
    // The next week: a new summary.
    await asOf(plus(today, 7), () => attention.runFor(tenantId));
    expect(await digestCount()).toBe(2);
    // Booked: no longer empty.
    await guest(far, 'Фома');
    expect((await listed()).filter((i) => i.weekStartDate === far)).toEqual([]);
  });

  it('a visit arranged in a hurry: its talk asked for from 4 weeks, its song from 2', async () => {
    const w = week(9);
    const g = await guest(w, 'Тимофей');
    const sunday = plus(w, 6);
    const reasons = async (day: string) =>
      asOf(day, async () =>
        (await attention.incomingAttention(tenantId))
          .filter((i) => i.weekStartDate === w)
          .map((i) => i.reason),
      );
    expect(await reasons(plus(sunday, -29))).toEqual([]);
    expect(await reasons(plus(sunday, -28))).toEqual(['needs_talk']);
    expect(await reasons(plus(sunday, -14))).toEqual([
      'no_lunch',
      'needs_talk',
      'needs_song',
    ]);
    // The summary of that week counts them.
    await clearDigests();
    await asOf(plus(sunday, -14), () => attention.runFor(tenantId));
    const body = await digestOn(plus(sunday, -14));
    expect(body).toMatch(/Речь не выбрана: [1-9]/);
    expect(body).toMatch(/Песня гостя не известна: [1-9]/);
    // Completed: they leave.
    // A special theme counts as chosen, as a talk from the list does.
    const r = await h.as('admin').patch(`/talk-exchange/${g}`, {
      specialTheme: 'Особая речь',
      openingSong: 88,
    });
    expect(r.status).toBe(200);
    expect(await reasons(plus(sunday, -14))).toEqual(['no_lunch']);
  });

  it("no lunch bag: listed from 14 days, counted in the summary; the bringer hears two days before; this week's guest is in the summary to remind", async () => {
    const w = week(5);
    const g = await guest(w, 'Лука');
    const sunday = plus(w, 6);
    // Fourteen days before: listed, not said.
    await asOf(plus(sunday, -14), async () => {
      const items = (await attention.incomingAttention(tenantId)).filter(
        (i) => i.weekStartDate === w,
      );
      expect(items.map((i) => i).map((i) => i.reason)).toContain('no_lunch');
    });
    await clearDigests();
    await asOf(plus(sunday, -7), () => attention.runFor(tenantId));
    expect(await told(`talk-attention:lunch:${g}`)).toBe(0);
    expect(await digestOn(plus(sunday, -7))).toMatch(
      /Ланч-пакет никто не несёт: [1-9]/,
    );

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
      expect(items.map((i) => i.reason)).not.toContain('no_lunch');
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

    // «Напомнить гостю»: the week's summary names this week's guest.
    await clearDigests();
    await asOf(w, () => attention.runFor(tenantId));
    expect(await digestOn(w)).toContain('Напомнить гостю:');
    expect(await digestOn(w)).toContain('Лука Гостев');
    expect(await told(`talk-attention:remind:${g}`)).toBe(0);
  });

  it('the sister who brings the lunch bag has it among her own tasks, with whom it is for', async () => {
    const w = week(6);
    const g = await guest(w, 'Матвей');
    const sister = await h.addPublisher({
      firstName: 'Ольга',
      lastName: 'Пакетова',
      gender: 'sister',
    });
    await h.addUser({ login: 'olga', role: 'publisher', publisherId: sister });
    await h
      .as('admin')
      .patch(`/talk-exchange/${g}`, { hospitalityPublisherId: sister });
    const mine = await h.as('olga').get('/me/assignments');
    expect(mine.status).toBe(200);
    expect(
      mine.body.items.filter((i: { kind: string }) => i.kind === 'guest_lunch'),
    ).toEqual([
      expect.objectContaining({
        kind: 'guest_lunch',
        date: plus(w, 6),
        label: 'Матвей Гостев',
      }),
    ]);
    // Taken off the visit: no longer hers.
    await h
      .as('admin')
      .patch(`/talk-exchange/${g}`, { hospitalityPublisherId: null });
    const after = await h.as('olga').get('/me/assignments');
    expect(
      after.body.items.filter(
        (i: { kind: string }) => i.kind === 'guest_lunch',
      ),
    ).toEqual([]);
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
