import { Harness, startHarness } from './harness';

/**
 * THE GENERAL CLEANING IS AN EVENT (special-events R-09, 25 November 2026) —
 * kept by the cleaning coordinator, the coordinator of the body of elders and
 * the administrators; the cleaning coordinator keeps that kind and no other.
 *
 *  admin   — the administrator
 *  bc      — the coordinator of the body of elders
 *  cleaner — the cleaning coordinator
 *  elder   — an elder with no responsibility
 *  pub     — a publisher
 */
type Who = 'admin' | 'bc' | 'cleaner' | 'elder' | 'pub';
const WHO: Who[] = ['admin', 'bc', 'cleaner', 'elder', 'pub'];
const KEEPERS: Who[] = ['admin', 'bc', 'cleaner'];

describe('the general cleaning as an event (real database)', () => {
  let h: Harness;
  let tenant: string;
  const login = (w: Who) => (w === 'admin' ? 'admin' : `gc${w}user`);
  const ok = (who: Who[], yes: number, no = 403) =>
    Object.fromEntries(WHO.map((w) => [w, who.includes(w) ? yes : no]));
  const row = async (
    act: (as: ReturnType<Harness['as']>, w: Who) => Promise<{ status: number }>,
  ) => {
    const got: Record<string, number> = {};
    for (const w of WHO) got[w] = (await act(h.as(login(w)), w)).status;
    return got;
  };
  const event = (type: string, date: string) => ({
    title: type === 'general_cleaning' ? 'Генеральная уборка' : 'Событие',
    type,
    date,
    time: '09:00',
  });

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
      await h.sql<{ id: string }>(`SELECT id FROM congregations LIMIT 1`)
    )[0].id;
    const person = async (w: Who, role: string, resp?: string) => {
      const id = await h.addPublisher({
        firstName: w,
        lastName: 'Уборка',
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
    await person('bc', 'elder', 'body_coordinator');
    await person('cleaner', 'ministerial_servant', 'cleaning_coordinator');
    await person('elder', 'elder');
    await person('pub', 'publisher');
  });
  afterAll(async () => {
    await h?.close();
  });

  it('a general cleaning is made by its three keepers and nobody else', async () => {
    let n = 0;
    expect(
      await row((as) =>
        as.post(
          '/special-events',
          event(
            'general_cleaning',
            `2033-03-${String(5 + n++).padStart(2, '0')}`,
          ),
        ),
      ),
    ).toEqual(ok(KEEPERS, 201));
  });

  it('the cleaning coordinator keeps that kind only', async () => {
    const cleaner = h.as(login('cleaner'));
    // No other kind of his own making.
    for (const type of ['memorial', 'other', 'circuit_assembly']) {
      const r = await cleaner.post(
        '/special-events',
        event(type, '2033-04-02'),
      );
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('EVENT_GENERAL_CLEANING_ONLY');
    }
    // His own: changed and removed.
    const mine = await cleaner.post(
      '/special-events',
      event('general_cleaning', '2033-04-09'),
    );
    expect(mine.status).toBe(201);
    expect(
      (
        await cleaner.patch(`/special-events/${mine.body.id}`, {
          time: '10:00',
        })
      ).status,
    ).toBe(200);
    // Not turned into another kind.
    expect(
      (
        await cleaner.patch(`/special-events/${mine.body.id}`, {
          type: 'other',
        })
      ).status,
    ).toBe(403);
    // Another kind, kept by the coordinator of the body of elders: not his.
    const theirs = await h
      .as(login('bc'))
      .post('/special-events', event('other', '2033-04-16'));
    expect(theirs.status).toBe(201);
    expect(
      (
        await cleaner.patch(`/special-events/${theirs.body.id}`, {
          time: '11:00',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await cleaner.patch(`/special-events/${theirs.body.id}`, {
          type: 'general_cleaning',
        })
      ).status,
    ).toBe(403);
    expect(
      (await cleaner.delete(`/special-events/${theirs.body.id}`)).status,
    ).toBe(403);
    // Nothing without a kind, and nobody else's brought back.
    expect(
      (
        await cleaner.post('/special-events', {
          title: 'Без вида',
          date: '2033-04-23',
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.as(login('bc')).delete(`/special-events/${theirs.body.id}`))
        .status,
    ).toBe(204);
    expect(
      (await cleaner.post(`/special-events/${theirs.body.id}/restore`)).status,
    ).toBe(403);
    // His own goes, and comes back.
    expect(
      (await cleaner.delete(`/special-events/${mine.body.id}`)).status,
    ).toBe(204);
    expect(
      (await cleaner.post(`/special-events/${mine.body.id}/restore`)).status,
    ).toBe(201);
  });

  it('a general cleaning never calls off or changes a meeting', async () => {
    const r = await h.as(login('cleaner')).post('/special-events', {
      ...event('general_cleaning', '2033-05-14'),
      replacesMeeting: true,
    });
    expect(r.status).toBe(201);
    const [saved] = await h.sql<{
      meeting_mode: string;
      replaces_meeting: boolean;
    }>(
      `SELECT meeting_mode, replaces_meeting FROM special_events WHERE id = $1`,
      [r.body.id],
    );
    expect(saved).toEqual({ meeting_mode: 'usual', replaces_meeting: false });
    const p = await h
      .as(login('cleaner'))
      .patch(`/special-events/${r.body.id}`, {
        meetingMode: 'changed',
        meetingTime: '12:00',
      });
    expect([200, 400]).toContain(p.status);
    const [after] = await h.sql<{ meeting_mode: string }>(
      `SELECT meeting_mode FROM special_events WHERE id = $1`,
      [r.body.id],
    );
    expect(after.meeting_mode).toBe('usual');
  });

  it('the old general slot of the cleaning says where it went', async () => {
    const r = await h.as(login('cleaner')).put('/cleaning', {
      weekStartDate: '2033-05-02',
      slotType: 'general',
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CLEANING_GENERAL_IS_EVENT');
    const p = await h.as('admin').patch('/cleaning/general-plan', {
      weekStartDate: '2033-05-02',
      plannedAt: null,
    });
    expect(p.status).toBe(400);
    expect(p.body.code).toBe('CLEANING_GENERAL_IS_EVENT');
  });
});
