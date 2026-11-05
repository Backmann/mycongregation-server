import { Harness, startHarness } from './harness';

/**
 * Who is told that a meeting moved (4 November 2026): everyone once, a person
 * with a part or a duty there his own notice instead of it, nobody at all for
 * a meeting moved after the fact — and moving it back is told again.
 */
describe('meeting moves: who is told (real database)', () => {
  let h: Harness;
  let tenantId: string;
  const users: Record<string, string> = {};
  const cards: Record<string, string> = {};

  const WEEK = '2027-04-05'; // midweek Wed 7th, weekend Sun 11th
  const PAST = '2026-10-05';

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    const settings = await h.as('admin').post('/meeting-settings', {
      effectiveFrom: '2025-01-06',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '10:00',
      address: 'Musterstraße 1, 59065 Hamm',
      confirmPast: true,
    });
    expect([200, 201]).toContain(settings.status);
    for (const login of ['reader1', 'speaker1', 'mic1', 'drafted1']) {
      cards[login] = await h.addPublisher({
        firstName: login,
        lastName: 'Тест',
        baptismDate: '2000-01-01',
      });
      users[login] = await h.addUser({
        login,
        role: 'publisher',
        publisherId: cards[login],
      });
    }
    await h.sql(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, part_order, publisher_id, status)
       VALUES ($1, $2, 'midweek', 'bible_reading', 5, $3, 'published'),
              ($1, $2, 'midweek', 'apply_yourself_1', 6, $4, 'draft')`,
      [tenantId, WEEK, cards.speaker1, cards.drafted1],
    );
    await h.sql(
      `INSERT INTO duties (congregation_id, week_start_date, event_type, duty_type, slot_index, publisher_id)
       VALUES ($1, $2, 'midweek', 'microphone', 0, $3)`,
      [tenantId, WEEK, cards.mic1],
    );
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    await h.sql(`DELETE FROM meeting_moves WHERE congregation_id = $1`, [
      tenantId,
    ]);
    await h.sql(
      `DELETE FROM notification_outbox WHERE congregation_id = $1 AND kind = 'meeting_move'`,
      [tenantId],
    );
  });

  const outbox = () =>
    h.sql<{ user_id: string; title: string; body: string }>(
      `SELECT user_id, title, body FROM notification_outbox
        WHERE congregation_id = $1 AND kind = 'meeting_move'`,
      [tenantId],
    );
  const of = (
    rows: { user_id: string; title: string; body: string }[],
    login: string,
  ) => rows.filter((r) => r.user_id === users[login]);

  it('everyone once; a part or a duty — his own notice instead', async () => {
    const r = await h.as('admin').put(`/meeting-moves/${WEEK}/midweek`, {
      date: '2027-04-08',
      time: '18:30',
    });
    expect(r.status).toBe(200);
    const rows = await outbox();

    const [reader] = of(rows, 'reader1');
    expect(of(rows, 'reader1')).toHaveLength(1);
    expect(reader.title).toBe('Встреча переносится');
    expect(reader.body).toContain('четверг, 8 апреля, в 18:30, Зал Царства');

    expect(of(rows, 'speaker1')).toHaveLength(1);
    expect(of(rows, 'speaker1')[0].title).toBe('Ваше назначение переносится');
    expect(of(rows, 'speaker1')[0].body).toMatch(/У вас: Чтение Библии\.$/);

    expect(of(rows, 'mic1')).toHaveLength(1);
    expect(of(rows, 'mic1')[0].title).toBe('Ваше назначение переносится');

    // A draft part was never told to him: he hears it with everyone.
    expect(of(rows, 'drafted1')).toHaveLength(1);
    expect(of(rows, 'drafted1')[0].title).toBe('Встреча переносится');
  });

  it('moving it back is told again, to everyone', async () => {
    await h.as('admin').put(`/meeting-moves/${WEEK}/midweek`, {
      date: '2027-04-08',
      time: '18:30',
    });
    await h.sql(
      `DELETE FROM notification_outbox WHERE congregation_id = $1 AND kind = 'meeting_move'`,
      [tenantId],
    );
    // «Back» is its own announcement, with its own key.
    const back = await h.as('admin').delete(`/meeting-moves/${WEEK}/midweek`);
    expect(back.status).toBe(200);
    const rows = await outbox();
    expect(of(rows, 'reader1').map((x) => x.title)).toEqual([
      'Встреча — снова как обычно',
    ]);
    expect(of(rows, 'speaker1').map((x) => x.title)).toEqual([
      'Ваше назначение — снова как обычно',
    ]);
  });

  it('a meeting moved after the fact is told to nobody', async () => {
    const r = await h.as('admin').put(`/meeting-moves/${PAST}/midweek`, {
      date: '2026-10-08',
      time: '19:00',
    });
    expect(r.status).toBe(200);
    expect(r.body.past).toBe(true);
    expect(await outbox()).toEqual([]);
  });
});

describe('meeting moves: the confirm screen (real database)', () => {
  let h: Harness;
  let tenantId: string;
  const cards: Record<string, string> = {};
  const WEEK = '2027-04-05';

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    for (const login of ['speaker2', 'mic2', 'drafted2']) {
      cards[login] = await h.addPublisher({
        firstName: login,
        lastName: 'Тест',
        baptismDate: '2000-01-01',
      });
      await h.addUser({ login, role: 'publisher', publisherId: cards[login] });
    }
    await h.sql(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, part_order, publisher_id, status)
       VALUES ($1, $2, 'midweek', 'bible_reading', 5, $3, 'published'),
              ($1, $2, 'midweek', 'apply_yourself_1', 6, $4, 'draft')`,
      [tenantId, WEEK, cards.speaker2, cards.drafted2],
    );
    await h.sql(
      `INSERT INTO duties (congregation_id, week_start_date, event_type, duty_type, slot_index, publisher_id)
       VALUES ($1, $2, 'midweek', 'microphone', 0, $3)`,
      [tenantId, WEEK, cards.mic2],
    );
    // Away on Thursday 8 April: the draft part and the microphone.
    await h.sql(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date)
       VALUES ($1, $2, '2027-04-08', NULL), ($1, $3, '2027-04-06', '2027-04-09')`,
      [tenantId, cards.drafted2, cards.mic2],
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('who is told, who gets his own notice, who is away on the new day (drafts too)', async () => {
    const r = await h
      .as('admin')
      .get(`/meeting-moves/${WEEK}/midweek/preview?date=2027-04-08`);
    expect(r.status).toBe(200);
    expect(r.body.members).toBeGreaterThanOrEqual(3);
    expect(r.body.ownNotice).toBe(2);
    expect(r.body.away).toEqual([
      {
        name: 'Тест drafted2',
        items: [
          { kind: 'meeting', label: 'apply_yourself_1', asAssistant: false },
        ],
      },
      { name: 'Тест mic2', items: [{ kind: 'duty', label: 'microphone' }] },
    ]);
    const tue = await h
      .as('admin')
      .get(`/meeting-moves/${WEEK}/midweek/preview?date=2027-04-05`);
    expect(tue.body.away).toEqual([]);
  });

  it('only for whoever may move that meeting', async () => {
    const r = await h
      .as('speaker2')
      .get(`/meeting-moves/${WEEK}/midweek/preview?date=2027-04-08`);
    expect(r.status).toBe(403);
  });
});
