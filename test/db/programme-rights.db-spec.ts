import { Harness, startHarness } from './harness';

/**
 * WHO MAY DO WHAT TO THE PROGRAMME — one table, held whole (rights review,
 * 21 November 2026). Each line: an action, then the answer each person gets.
 * A change of rights, meant or not, changes a cell here first.
 *
 *  admin — the administrator
 *  lmo   — the Life and Ministry meeting overseer (the midweek)
 *  bc    — the coordinator of the body of elders (the weekend, the Memorial)
 *  bca   — his assistant, who stands in for him (Lionel, 21 November 2026)
 *  elder — an elder with no responsibility
 *  ms    — a ministerial servant
 *  pub   — a publisher
 */
type Who = 'admin' | 'lmo' | 'bc' | 'bca' | 'elder' | 'ms' | 'pub';
const WHO: Who[] = ['admin', 'lmo', 'bc', 'bca', 'elder', 'ms', 'pub'];

describe('the programme: who may do what (real database)', () => {
  let h: Harness;
  let memorialId: string;
  const login = (w: Who) => (w === 'admin' ? 'admin' : `rights${w}user`);
  // Far ahead and one week per action, so no answer depends on another.
  let n = 0;
  const week = () => {
    const d = new Date(Date.UTC(2033, 0, 3 + 7 * n++));
    return d.toISOString().slice(0, 10);
  };
  const mk = async (w: string, eventType: string, partKey: string) => {
    const r = await h
      .as('admin')
      .post('/assignments', { weekStartDate: w, eventType, partKey });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };

  beforeAll(async () => {
    h = await startHarness();
    const tenant = (
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
        lastName: 'Права',
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
    };
    await person('lmo', 'elder', 'life_ministry_overseer');
    await person('bc', 'elder', 'body_coordinator');
    await person('bca', 'elder', 'body_coordinator_assistant');
    await person('elder', 'elder');
    await person('ms', 'ministerial_servant');
    await person('pub', 'publisher');
    const ev = await h.as('admin').post('/special-events', {
      title: 'Вечеря воспоминания',
      type: 'memorial',
      date: '2033-04-14',
      time: '19:30',
    });
    expect([200, 201]).toContain(ev.status);
    memorialId = ev.body.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  /** Asks each person; returns «who=status» for the whole row. */
  const row = async (
    act: (as: ReturnType<Harness['as']>, w: Who) => Promise<{ status: number }>,
  ) => {
    const got: Record<string, number> = {};
    for (const w of WHO) got[w] = (await act(h.as(login(w)), w)).status;
    return got;
  };
  const ok = (who: Who[], yes: number, no = 403) =>
    Object.fromEntries(WHO.map((w) => [w, who.includes(w) ? yes : no]));
  const MIDWEEK: Who[] = ['admin', 'lmo'];
  const WEEKEND: Who[] = ['admin', 'bc', 'bca'];

  it('adds a part: the midweek, the weekend, the Memorial', async () => {
    expect(
      await row((as) =>
        as.post('/assignments', {
          weekStartDate: week(),
          eventType: 'midweek',
          partKey: 'midweek_song',
        }),
      ),
    ).toEqual(ok(MIDWEEK, 201));
    expect(
      await row((as) =>
        as.post('/assignments', {
          weekStartDate: week(),
          eventType: 'weekend',
          partKey: 'weekend_song',
        }),
      ),
    ).toEqual(ok(WEEKEND, 201));
    expect(
      await row((as) =>
        as.post('/assignments', {
          weekStartDate: week(),
          eventType: 'memorial',
          partKey: 'memorial_song',
        }),
      ),
    ).toEqual(ok(WEEKEND, 201));
  });

  it('moves a part to the other meeting only with the rights to both', async () => {
    const w = week();
    expect(
      await row(async (as) =>
        // A part of neither meeting by its key: only the rights are asked.
        as.patch(`/assignments/${await mk(w, 'midweek', 'other_part')}`, {
          eventType: 'weekend',
        }),
      ),
    ).toEqual(ok(['admin'], 200));
    expect(
      await row(async (as) =>
        as.patch(`/assignments/${await mk(w, 'weekend', 'other_part')}`, {
          eventType: 'midweek',
        }),
      ),
    ).toEqual(ok(['admin'], 200));
  });

  it('swaps the public talks: the weekend only, whatever the request says', async () => {
    const a = week();
    const b = week();
    await mk(a, 'weekend', 'public_talk_speaker');
    await mk(b, 'weekend', 'public_talk_speaker');
    // «midweek» was let through by the guard and then swapped the weekend.
    const sneaky = await row((as) =>
      as.post('/assignments/public-talk/swap', {
        eventType: 'midweek',
        sourceWeekStartDate: a,
        targetWeekStartDate: b,
        mode: 'swap',
      }),
    );
    expect(sneaky.lmo).not.toBe(201);
    expect(Object.values(sneaky).every((s) => s === 400 || s === 403)).toBe(
      true,
    );
    const got = await row((as) =>
      as.post('/assignments/public-talk/swap', {
        eventType: 'weekend',
        sourceWeekStartDate: a,
        targetWeekStartDate: b,
        mode: 'swap',
      }),
    );
    expect(got).toEqual(ok(WEEKEND, 201));
  });

  it('a part of one meeting is not put into another', async () => {
    const r = await h.as('admin').post('/assignments', {
      weekStartDate: week(),
      eventType: 'midweek',
      partKey: 'watchtower_conductor',
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PART_NOT_IN_MEETING');
    const id = await mk(week(), 'midweek', 'midweek_song');
    const moved = await h
      .as('admin')
      .patch(`/assignments/${id}`, { partKey: 'public_talk_speaker' });
    expect(moved.body.code).toBe('PART_NOT_IN_MEETING');
  });

  it('removes and restores a part: the rights of its meeting', async () => {
    const w = week();
    const del = await row(async (as) =>
      as.delete(`/assignments/${await mk(w, 'weekend', 'weekend_song')}`),
    );
    expect(del).toEqual(ok(WEEKEND, 204));
    // Each person brings back a part of his own, removed by the admin.
    const back = await row(async (as) => {
      const id = await mk(w, 'midweek', 'midweek_song');
      expect((await h.as('admin').delete(`/assignments/${id}`)).status).toBe(
        204,
      );
      return as.post(`/assignments/${id}/restore`);
    });
    expect(back).toEqual(ok(MIDWEEK, back.admin));
    expect(back.admin).toBeLessThan(300);
  });

  it('a batch over both meetings needs both', async () => {
    const w = week();
    const batch = {
      assignments: [
        { weekStartDate: w, eventType: 'midweek', partKey: 'other_part' },
        { weekStartDate: w, eventType: 'weekend', partKey: 'other_part' },
      ],
    };
    expect(await row((as) => as.post('/assignments/bulk', batch))).toEqual(
      ok(['admin'], 201),
    );
  });

  it('the overseer cannot turn his part into a weekend one', async () => {
    const id = await mk(week(), 'midweek', 'other_part');
    const r = await h.as(login('lmo')).patch(`/assignments/${id}`, {
      eventType: 'weekend',
      partKey: 'watchtower_conductor',
    });
    expect(r.status).toBe(403);
  });

  it('a request naming no meeting at all is refused, not a crash', async () => {
    const id = await mk(week(), 'midweek', 'other_part');
    for (const eventType of ['constructor', '__proto__', 'nonsense']) {
      const r = await h
        .as(login('lmo'))
        .patch(`/assignments/${id}`, { eventType });
      expect([400, 403]).toContain(r.status);
    }
  });

  it('publishes a meeting', async () => {
    const w = week();
    await mk(w, 'midweek', 'midweek_song');
    await mk(w, 'weekend', 'weekend_song');
    expect(
      await row((as) =>
        as.post('/assignments/publish', {
          weekStartDate: w,
          eventType: 'midweek',
        }),
      ),
    ).toEqual(ok(MIDWEEK, 201));
    expect(
      await row((as) =>
        as.post('/assignments/publish', {
          weekStartDate: w,
          eventType: 'weekend',
        }),
      ),
    ).toEqual(ok(WEEKEND, 201));
  });

  it('loads a file: the workbook for the midweek, The Watchtower for the weekend', async () => {
    const load = (partKey: string, title: string) => {
      const w = week();
      const end = new Date(`${w}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 6);
      return {
        epubFile: 'x.epub',
        weeks: [
          {
            weekStartDate: w,
            weekEndDate: end.toISOString().slice(0, 10),
            parts: [{ partKey, partOrder: 1, partTitle: title }],
          },
        ],
      };
    };
    expect(
      await row((as) =>
        as.post('/mwb-import/apply', load('treasures_talk', 'Тема')),
      ),
    ).toEqual(ok(MIDWEEK, 201));
    expect(
      await row((as) =>
        as.post('/mwb-import/apply', load('watchtower_conductor', 'Статья')),
      ),
    ).toEqual(ok(WEEKEND, 201));
    // A week is one meeting: a weekend key in a workbook week is refused.
    const mixed = load('treasures_talk', 'Тема');
    mixed.weeks[0].parts.push({
      partKey: 'public_talk_speaker',
      partOrder: 2,
      partTitle: 'Речь',
    });
    const r = await h.as('admin').post('/mwb-import/apply', mixed);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('PART_NOT_IN_MEETING');
    // What is loaded, the elders read.
    expect(await row((as) => as.get('/mwb-import/weeks'))).toEqual(
      ok(['admin', 'lmo', 'bc', 'bca', 'elder'], 200),
    );
  });

  it('the Memorial programme: written by its coordinators, read by the elders', async () => {
    expect(
      await row((as) =>
        as.patch(`/memorial/${memorialId}/theme`, { theme: 'Тема года' }),
      ),
    ).toEqual(ok(WEEKEND, 200));
    expect(
      await row((as) => as.post(`/memorial/${memorialId}/prepare`)),
    ).toEqual(
      // prepare fills an EMPTY Memorial: once filled, it says so, not 403.
      expect.objectContaining({ lmo: 403, elder: 403, ms: 403, pub: 403 }),
    );
    const published = await row((as) =>
      as.post(`/memorial/${memorialId}/publish`),
    );
    expect([
      published.lmo,
      published.elder,
      published.ms,
      published.pub,
    ]).toEqual([403, 403, 403, 403]);
    expect(
      [published.admin, published.bc, published.bca].every((s) => s < 300),
    ).toBe(true);
    const sheet = await row((as) => as.get(`/memorial/${memorialId}`));
    expect(sheet).toEqual(ok(WHO, 200));
  });

  it('the responsibilities that carry these rights go to elders only', async () => {
    const [ms] = await h.sql<{ id: string }>(
      `SELECT id FROM users WHERE login_name = $1`,
      [login('ms')],
    );
    for (const type of [
      'life_ministry_overseer',
      'body_coordinator_assistant',
    ]) {
      const r = await h
        .as('admin')
        .post('/responsibilities', { type, userId: ms.id });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('RESPONSIBILITY_ELDERS_ONLY');
    }
  });

  it('drafts and readiness: those who build the programme', async () => {
    const w = week();
    await mk(w, 'weekend', 'weekend_song');
    const seen = await row(async (as) => {
      // weekEnd is exclusive.
      const next = new Date(`${w}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 7);
      const r = await as.get(
        `/assignments?weekStart=${w}&weekEnd=${next.toISOString().slice(0, 10)}`,
      );
      return { status: r.status === 200 && r.body.data.length > 0 ? 1 : 0 };
    });
    expect(seen).toEqual(ok(['admin', 'lmo', 'bc', 'bca'], 1, 0));
    expect(
      await row((as) => as.get(`/readiness?weekStart=${w}&weekEnd=${w}`)),
    ).toEqual(ok(['admin', 'lmo', 'bc', 'bca'], 200));
  });

  it('moves a meeting: its editors', async () => {
    const w = week();
    const date = new Date(`${w}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 5);
    const sat = date.toISOString().slice(0, 10);
    expect(
      await row((as) =>
        as.get(`/meeting-moves/${w}/weekend/preview?date=${sat}`),
      ),
    ).toEqual(ok(WEEKEND, 200));
    expect(
      await row((as) =>
        as.get(`/meeting-moves/${w}/midweek/preview?date=${sat}`),
      ),
    ).toEqual(ok(MIDWEEK, 200));
  });
});
