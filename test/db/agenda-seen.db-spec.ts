import { Harness, startHarness } from './harness';

/**
 * «Изменено» on Home (9 November 2026): what changed in one's own coming
 * items since Home was last seen. Each case has its reverse: the same check
 * on the unchanged state says nothing.
 *
 * The agenda reads from today on, so the weeks here are counted from today:
 * five and six weeks ahead, far from any freeze.
 */
describe('what changed since Home was last seen (real database)', () => {
  let h: Harness;
  let tenant = '';
  let anna = '';
  let lena = '';
  let peter = '';

  const mondayIn = (weeks: number): string => {
    const d = new Date();
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + weeks * 7);
    return d.toISOString().slice(0, 10);
  };
  const W1 = mondayIn(5);
  const W2 = mondayIn(6);

  type Change = {
    id: string;
    kind: 'new' | 'changed';
    fields: string[];
    before: {
      date: string;
      start: string | null;
      title: string;
      with: string[];
      place: string | null;
    } | null;
  };
  type Changes = {
    first: boolean;
    changes: Change[];
    removed: {
      id: string;
      date: string;
      start: string | null;
      title: string;
    }[];
  };
  const changes = async (who: string): Promise<Changes> => {
    const r = await h.as(who).get('/me/agenda/changes');
    expect(r.status).toBe(200);
    return r.body as Changes;
  };
  const seen = async (who: string): Promise<number> => {
    const r = await h.as(who).post('/me/agenda/seen', {});
    expect(r.status).toBe(200);
    return (r.body as { items: number }).items;
  };
  const part = async (
    week: string,
    key: string,
    who: string,
    assistant: string | null = null,
  ): Promise<string> =>
    (
      await h.sql<{ id: string }>(
        `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, publisher_id, assistant_publisher_id, status)
         VALUES ($1, $2, 'midweek', $3, $4, $5, 'published') RETURNING id`,
        [tenant, week, key, who, assistant],
      )
    )[0].id;

  beforeAll(async () => {
    h = await startHarness();
    [{ id: tenant }] = await h.sql<{ id: string }>(
      `SELECT id FROM congregations LIMIT 1`,
    );
    const settings = await h.as('admin').post('/meeting-settings', {
      effectiveFrom: '2026-01-05',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '10:00',
      address: 'Lindenstraße 12, Nordwald',
      confirmPast: true,
    });
    expect([200, 201]).toContain(settings.status);
    anna = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Берг',
      gender: 'sister',
      baptismDate: '2015-01-01',
    });
    lena = await h.addPublisher({
      firstName: 'Лена',
      lastName: 'Кляйн',
      gender: 'sister',
      baptismDate: '2016-01-01',
    });
    peter = await h.addPublisher({
      firstName: 'Петра',
      lastName: 'Шульц',
      gender: 'sister',
      baptismDate: '2001-01-01',
    });
    await h.addUser({ login: 'anna', role: 'publisher', publisherId: anna });
    await h.addUser({ login: 'lena', role: 'publisher', publisherId: lena });
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    await h.sql(`DELETE FROM assignments WHERE congregation_id = $1`, [tenant]);
    await h.sql(`DELETE FROM agenda_seen WHERE congregation_id = $1`, [tenant]);
  });

  it('first visit: no marks at all, even with things ahead', async () => {
    await part(W1, 'bible_reading', anna);
    const c = await changes('anna');
    expect(c).toEqual({ first: true, changes: [], removed: [] });
    // Reverse: once seen, it is no longer the first visit.
    expect(await seen('anna')).toBe(1);
    expect((await changes('anna')).first).toBe(false);
  });

  it('nothing changed: nothing marked', async () => {
    await part(W1, 'bible_reading', anna);
    await seen('anna');
    expect(await changes('anna')).toEqual({
      first: false,
      changes: [],
      removed: [],
    });
  });

  it('a new part is «new»; seeing it clears the mark', async () => {
    await part(W1, 'bible_reading', anna);
    await seen('anna');
    const id = await part(W2, 'bible_reading', anna);
    const c = await changes('anna');
    expect(c.changes).toEqual([
      { id: `part:${id}`, kind: 'new', fields: [], before: null },
    ]);
    await seen('anna');
    expect((await changes('anna')).changes).toEqual([]);
  });

  it('a new partner is «changed: with», with the old name', async () => {
    const id = await part(W1, 'starting_conversation_1', anna, lena);
    await seen('anna');
    await h.sql(
      `UPDATE assignments SET assistant_publisher_id = $1 WHERE id = $2`,
      [peter, id],
    );
    const [c] = (await changes('anna')).changes;
    expect(c).toMatchObject({
      id: `part:${id}`,
      kind: 'changed',
      fields: ['with'],
      before: { with: ['Кляйн Лена'] },
    });
    // The assistant sees her own row as new, not Anna's change.
    const lenaFirst = await changes('lena');
    expect(lenaFirst.first).toBe(true);
  });

  it('names as the app writes them; a snapshot in the old order is no change', async () => {
    const id = await part(W1, 'starting_conversation_1', anna, lena);
    await seen('anna');
    const [{ with: w }] = await h.sql<{ with: string[] }>(
      `SELECT "with" FROM agenda_seen WHERE item_id = $1`,
      [`part:${id}`],
    );
    expect(w).toEqual(['Кляйн Лена']);
    // The calendar keeps its own order.
    const ag = await h.as('anna').get('/me/agenda');
    const row = (
      ag.body as { items: { id: string; with: string[] }[] }
    ).items.find((x) => x.id === `part:${id}`);
    expect(row?.with).toEqual(['Лена Кляйн']);
    // Kept before the change: «Лена Кляйн» — the same person.
    await h.sql(
      `UPDATE agenda_seen SET "with" = '["Лена Кляйн"]' WHERE item_id = $1`,
      [`part:${id}`],
    );
    expect((await changes('anna')).changes).toEqual([]);
    // Reverse: somebody else in the old order IS a change.
    await h.sql(
      `UPDATE agenda_seen SET "with" = '["Петра Шульц"]' WHERE item_id = $1`,
      [`part:${id}`],
    );
    expect((await changes('anna')).changes.map((c) => c.fields)).toEqual([
      ['with'],
    ]);
  });

  it('another part instead: «changed: title»', async () => {
    const id = await part(W1, 'bible_reading', anna);
    await seen('anna');
    const [{ title }] = await h.sql<{ title: string }>(
      `SELECT title FROM agenda_seen WHERE item_id = $1`,
      [`part:${id}`],
    );
    await h.sql(
      `UPDATE assignments SET part_key = 'starting_conversation_1' WHERE id = $1`,
      [id],
    );
    const [c] = (await changes('anna')).changes;
    expect(c).toMatchObject({
      kind: 'changed',
      fields: ['title'],
      before: { title },
    });
  });

  it('another hour, day or place than was seen: each is named', async () => {
    const id = await part(W1, 'bible_reading', anna);
    await seen('anna');
    const row = `part:${id}`;
    // What she saw was another hour and place (as if the settings changed).
    await h.sql(
      `UPDATE agenda_seen SET start = '18:30', place = 'Alter Saal' WHERE item_id = $1`,
      [row],
    );
    const [c] = (await changes('anna')).changes;
    expect(c).toMatchObject({
      fields: ['start', 'place'],
      before: { start: '18:30', place: 'Alter Saal' },
    });
    await h.sql(
      `UPDATE agenda_seen SET start = '19:00', place = 'Lindenstraße 12, Nordwald', date = date - 1 WHERE item_id = $1`,
      [row],
    );
    const [d] = (await changes('anna')).changes;
    expect(d.fields).toEqual(['date']);
  });

  it('another app language: titles are not «changed», a moved day still is', async () => {
    const id = await part(W1, 'bible_reading', anna);
    await seen('anna');
    await h.sql(
      `UPDATE users SET ui_language = 'en' WHERE login_name = 'anna'`,
    );
    try {
      expect((await changes('anna')).changes).toEqual([]);
      // Reverse: the old row did hold another title — compared, it would differ.
      const [{ title }] = await h.sql<{ title: string }>(
        `SELECT title FROM agenda_seen WHERE item_id = $1`,
        [`part:${id}`],
      );
      const r = await h.as('anna').get('/me/agenda');
      const now = (r.body as { items: { id: string; title: string }[] }).items;
      expect(now.find((x) => x.id === `part:${id}`)?.title).not.toBe(title);
      // What really moved is still said.
      await h.sql(`UPDATE agenda_seen SET date = date - 1 WHERE item_id = $1`, [
        `part:${id}`,
      ]);
      expect((await changes('anna')).changes.map((c) => c.fields)).toEqual([
        ['date'],
      ]);
      // Seen in the new language, its titles are compared again.
      await seen('anna');
      await h.sql(
        `UPDATE agenda_seen SET title = 'Something else' WHERE item_id = $1`,
        [`part:${id}`],
      );
      expect((await changes('anna')).changes.map((c) => c.fields)).toEqual([
        ['title'],
      ]);
    } finally {
      await h.sql(
        `UPDATE users SET ui_language = 'ru' WHERE login_name = 'anna'`,
      );
    }
  });

  it('a part taken away is «removed», with what it was', async () => {
    const id = await part(W1, 'bible_reading', anna);
    await part(W2, 'bible_reading', anna);
    await seen('anna');
    await h.sql(`DELETE FROM assignments WHERE id = $1`, [id]);
    const c = await changes('anna');
    expect(c.changes).toEqual([]);
    expect(c.removed).toEqual([
      expect.objectContaining({ id: `part:${id}`, start: '19:00' }),
    ]);
    await seen('anna');
    expect((await changes('anna')).removed).toEqual([]);
  });

  it('a day gone by is not «removed», and seeing Home drops it', async () => {
    await part(W1, 'bible_reading', anna);
    await seen('anna');
    await h.sql(
      `INSERT INTO agenda_seen (user_id, item_id, congregation_id, date, start, title)
       SELECT user_id, 'part:old', congregation_id, CURRENT_DATE - 3, '19:00', 'Old'
         FROM agenda_seen LIMIT 1`,
    );
    expect((await changes('anna')).removed).toEqual([]);
    await seen('anna');
    const left = await h.sql(
      `SELECT 1 FROM agenda_seen WHERE item_id = 'part:old'`,
    );
    expect(left).toHaveLength(0);
    // Days gone by are dropped for everybody, not only for the one who looks.
    await h.sql(
      `INSERT INTO agenda_seen (user_id, item_id, congregation_id, date, start, title)
       SELECT id, 'part:lenas-old', $1, CURRENT_DATE - 3, '19:00', 'Old'
         FROM users WHERE login_name = $2`,
      [tenant, 'lena'],
    );
    await seen('anna');
    expect(
      await h.sql(`SELECT 1 FROM agenda_seen WHERE item_id = 'part:lenas-old'`),
    ).toHaveLength(0);
    // Reverse: the same row on a coming day IS reported.
    await h.sql(
      `INSERT INTO agenda_seen (user_id, item_id, congregation_id, date, start, title)
       SELECT user_id, 'part:gone', congregation_id, CURRENT_DATE + 3, '19:00', 'Gone'
         FROM agenda_seen LIMIT 1`,
    );
    expect((await changes('anna')).removed.map((r) => r.id)).toEqual([
      'part:gone',
    ]);
  });

  it('«my assignments» name their agenda row, as the main person and as the assistant', async () => {
    const id = await part(W1, 'starting_conversation_1', anna, lena);
    for (const who of ['anna', 'lena']) {
      const mine = await h.as(who).get('/me/assignments');
      expect(mine.status).toBe(200);
      const ids = (mine.body as { items: { agendaId?: string }[] }).items.map(
        (x) => x.agendaId,
      );
      expect(ids).toEqual([`part:${id}`]);
      const ag = await h.as(who).get('/me/agenda');
      const rows = (ag.body as { items: { id: string }[] }).items.map(
        (x) => x.id,
      );
      // Same id, or its first part (the assistant's row ends in «:assistant»).
      expect(
        rows.filter((r) => r === ids[0] || r.startsWith(`${ids[0]}:`)),
      ).toHaveLength(1);
    }
  });

  it('a login with no publisher: no marks, nothing kept', async () => {
    await h.addUser({ login: 'nobody', role: 'publisher' });
    expect(await changes('nobody')).toEqual({
      first: true,
      changes: [],
      removed: [],
    });
    expect(await seen('nobody')).toBe(0);
  });
});
