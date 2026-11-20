import { Harness, startHarness } from './harness';

/**
 * «Файлы программы» (20 November 2026): which weeks have their programme,
 * whether it came from a file, and which held week is the next one missing.
 */
describe('programme files: the weeks summary (real database)', () => {
  let h: Harness;
  // Far ahead, so no other spec's rows share these weeks.
  const W0 = '2032-03-01';
  const plus = (iso: string, days: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const W1 = plus(W0, 7);
  const W2 = plus(W0, 14);
  const W3 = plus(W0, 21);

  const load = (week: string, parts: Array<[string, number, string | null]>) =>
    h.as('admin').post('/mwb-import/apply', {
      epubFile: 'test.epub',
      weeks: [
        {
          weekStartDate: week,
          weekEndDate: plus(week, 6),
          parts: parts.map(([partKey, partOrder, partTitle]) => ({
            partKey,
            partOrder,
            partTitle,
          })),
        },
      ],
    });
  const summary = async (q = `from=${W0}&count=4`) => {
    const r = await h.as('admin').get(`/mwb-import/weeks?${q}`);
    expect(r.status).toBe(200);
    return r.body as {
      weeks: Array<{
        weekStart: string;
        midweek: Record<string, number | boolean>;
        weekend: Record<string, number | boolean>;
      }>;
      loadedUntil: { midweek: string | null; weekend: string | null };
      nextMissing: { midweek: string | null; weekend: string | null };
    };
  };

  beforeAll(async () => {
    h = await startHarness();
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

    // W0: both meetings from files; one title changed by hand afterwards,
    // one extra part cancelled.
    expect([200, 201]).toContain(
      (
        await load(W0, [
          ['treasures_talk', 1, 'Сокровища: первая мысль'],
          ['living_christians_1', 10, 'Из тетради'],
          ['living_christians_2', 11, 'Вторая часть'],
        ])
      ).status,
    );
    expect([200, 201]).toContain(
      (
        await load(W0, [
          ['public_talk_speaker', 1, null],
          ['watchtower_conductor', 2, 'Статья недели'],
          ['weekend_closing_prayer', 3, 'Песня 5 и молитва'],
        ])
      ).status,
    );
    const [lc] = await h.sql<{ id: string }>(
      `SELECT id FROM assignments
        WHERE week_start_date = $1 AND part_key = 'living_christians_1'`,
      [W0],
    );
    const edit = await h
      .as('admin')
      .patch(`/assignments/${lc.id}`, { partTitle: 'Местная тема' });
    expect(edit.status).toBe(200);
    await h.sql(
      `UPDATE assignments SET status = 'cancelled'
        WHERE week_start_date = $1 AND part_key = 'living_christians_2'`,
      [W0],
    );

    // The visit template empties a closing prayer's title: not «by hand».
    await h.sql(
      `UPDATE assignments SET part_title = NULL
        WHERE week_start_date = $1 AND part_key = 'weekend_closing_prayer'`,
      [W0],
    );
    // One person named, to compare with the readiness badge.
    const brother = await h.addPublisher({
      firstName: 'Тест',
      lastName: 'Докладчик',
      appointment: 'elder',
    });
    const [tt] = await h.sql<{ id: string }>(
      `SELECT id FROM assignments
        WHERE week_start_date = $1 AND part_key = 'treasures_talk'`,
      [W0],
    );
    await h.sql(`UPDATE assignments SET publisher_id = $1 WHERE id = $2`, [
      brother,
      tt.id,
    ]);

    // W1: single parts added by hand — not a programme.
    for (const [eventType, partKey] of [
      ['midweek', 'treasures_talk'],
      ['weekend', 'public_talk_speaker'],
    ]) {
      const r = await h
        .as('admin')
        .post('/assignments', { weekStartDate: W1, eventType, partKey });
      expect(r.status).toBe(201);
    }

    // W2: a convention — no meetings at all that week.
    const ev = await h.as('admin').post('/special-events', {
      title: 'Конгресс',
      type: 'regional_convention',
      date: plus(W2, 4),
      endDate: plus(W2, 6),
    });
    expect(ev.status).toBe(201);
    // W3: nothing.
  });
  afterAll(async () => {
    await h?.close();
  });

  it('says which meeting came from a file, which was made by hand, and which is empty', async () => {
    const s = await summary();
    expect(s.weeks.map((w) => w.weekStart)).toEqual([W0, W1, W2, W3]);
    const [w0, w1, w2, w3] = s.weeks;

    expect(w0.midweek).toMatchObject({
      held: true,
      programme: true,
      parts: 2,
      fromFile: true,
      byHand: 1,
    });
    expect(w0.weekend).toMatchObject({
      held: true,
      programme: true,
      parts: 3,
      fromFile: true,
      byHand: 0,
    });

    // A lone part is not the week's programme (review, 20 November 2026).
    expect(w1.midweek).toMatchObject({
      held: true,
      programme: false,
      parts: 1,
      fromFile: false,
    });
    expect(w1.weekend).toMatchObject({
      held: true,
      programme: false,
      parts: 1,
    });

    expect(w2.midweek).toMatchObject({ held: false, parts: 0 });
    expect(w2.weekend).toMatchObject({ held: false, parts: 0 });

    expect(w3.midweek).toMatchObject({
      held: true,
      programme: false,
      parts: 0,
      fromFile: false,
    });
  });

  it('counts named people the same way as the readiness badge', async () => {
    const s = await summary();
    const r = await h
      .as('admin')
      .get(`/readiness?weekStart=${W0}&weekEnd=${W1}`);
    expect(r.status).toBe(200);
    const week = (r.body as Array<Record<string, any>>).find(
      (w) => String(w.weekStart).slice(0, 10) === W0,
    );
    const badge = week?.meetings?.find(
      (m: Record<string, any>) => m.kind === 'midweek',
    )?.programme;
    const m = s.weeks[0].midweek;
    expect(m.assigned).toBe(1);
    expect({ assigned: m.assigned, total: m.total }).toEqual({
      assigned: badge?.assigned,
      total: badge?.total,
    });
  });

  it('skips a week without meetings when naming the next one to load', async () => {
    const s = await summary();
    expect(s.loadedUntil).toEqual({ midweek: W0, weekend: W0 });
    // W1 holds single parts only: it is still missing its programme.
    expect(s.nextMissing).toEqual({ midweek: W1, weekend: W1 });
  });

  it('takes up to 30 weeks and refuses a malformed request', async () => {
    const s = await summary(`from=${W0}&count=30`);
    expect(s.weeks).toHaveLength(30);
    expect(
      (await h.as('admin').get('/mwb-import/weeks?from=next-week')).status,
    ).toBe(400);
    expect(
      (await h.as('admin').get('/mwb-import/weeks?count=500')).status,
    ).toBe(400);
    for (const bad of ['2026-13-45', '2026-02-31']) {
      expect(
        (await h.as('admin').get(`/mwb-import/weeks?from=${bad}`)).status,
      ).toBe(400);
    }
  });

  it("starts two weeks before the congregation's own current week", async () => {
    const r = await h.as('admin').get('/mwb-import/weeks');
    expect(r.status).toBe(200);
    const { thisWeek, weeks } = r.body as {
      thisWeek: string;
      weeks: { weekStart: string }[];
    };
    expect(new Date(`${thisWeek}T00:00:00Z`).getUTCDay()).toBe(1);
    // Within a day of UTC's Monday — the congregation's zone may differ.
    const utc = new Date();
    utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
    const days =
      Math.abs(
        Date.parse(`${thisWeek}T00:00:00Z`) -
          Date.parse(`${utc.toISOString().slice(0, 10)}T00:00:00Z`),
      ) / 86_400_000;
    expect(days === 0 || days === 7).toBe(true);
    expect(weeks).toHaveLength(18);
    expect(weeks[0].weekStart).toBe(plus(thisWeek, -14));
  });

  it('is for admins and elders only', async () => {
    const pub = await h.addPublisher({ firstName: 'Тест', lastName: 'Чтец' });
    await h.addUser({
      login: 'readerfiles',
      role: 'publisher',
      publisherId: pub,
    });
    expect((await h.as('readerfiles').get('/mwb-import/weeks')).status).toBe(
      403,
    );
    expect((await h.as(null).get('/mwb-import/weeks')).status).toBe(401);
  });
});
