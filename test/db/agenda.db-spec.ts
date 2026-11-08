import { Harness, startHarness } from './harness';

/**
 * One person's agenda (7 November 2026): each thing on its REAL day and hour,
 * as the week rules give them — and what is not held, or is a draft, or is
 * nobody's business, kept out or marked. The calendar feed reads this, so a
 * mistake here lands in people's phones.
 *
 * Weeks of 2027, far from today, so the clock does not matter; each test asks
 * for its own span.
 */
describe('a person’s agenda (real database)', () => {
  let h: Harness;
  let tenant = '';
  let anna = ''; // a sister: parts, cart, cleaning
  let lena = ''; // her householder
  let peter = ''; // an elder
  let groupId = '';

  // Settings: midweek on Wednesday 19:00, weekend on Sunday 10:00.
  const W1 = '2027-03-01'; // ordinary week: Wed 3rd, Sun 7th
  const W2 = '2027-03-08'; // midweek moved to Monday 8th, 18:30
  const W3 = '2027-03-15'; // circuit overseer: midweek on Tuesday 16th
  const W4 = '2027-03-22'; // regional convention Fri 26th — Sun 28th
  const W5 = '2027-04-05'; // Memorial on Thursday 8th: takes the midweek
  const W6 = '2027-04-12'; // Anna away on Wednesday 14th

  type Item = {
    id: string;
    kind: string;
    scope: string;
    date: string;
    endDate: string | null;
    start: string | null;
    end: string | null;
    title: string;
    detail: string | null;
    meetingKey: string | null;
    meeting: string | null;
    asAssistant: boolean;
    with: string[];
    place: string | null;
    state: string;
    notHeldReason: string | null;
    eventType: string | null;
  };
  const agenda = async (
    who: string,
    from = '2027-03-01',
    to = '2027-04-30',
  ): Promise<Item[]> => {
    const r = await h.as(who).get(`/me/agenda?from=${from}&to=${to}`);
    expect(r.status).toBe(200);
    return (r.body as { items: Item[] }).items;
  };
  const part = async (
    week: string,
    kind: 'midweek' | 'weekend',
    key: string,
    who: string,
    opts: { assistant?: string; status?: string; title?: string } = {},
  ): Promise<string> =>
    (
      await h.sql<{ id: string }>(
        `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, part_title, publisher_id, assistant_publisher_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          tenant,
          week,
          kind,
          key,
          opts.title ?? null,
          who,
          opts.assistant ?? null,
          opts.status ?? 'published',
        ],
      )
    )[0].id;
  const event = async (
    type: string,
    date: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const cols = [
      'congregation_id',
      'title',
      'type',
      'date',
      ...Object.keys(extra),
    ];
    const vals = [
      tenant,
      `Событие ${type}`,
      type,
      date,
      ...Object.values(extra),
    ];
    return (
      await h.sql<{ id: string }>(
        `INSERT INTO special_events (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        vals,
      )
    )[0].id;
  };

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
    [{ id: groupId }] = await h.sql<{ id: string }>(
      `INSERT INTO service_groups (congregation_id, name) VALUES ($1, 'Группа 1') RETURNING id`,
      [tenant],
    );
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
      firstName: 'Петер',
      lastName: 'Шульц',
      gender: 'brother',
      baptismDate: '2001-01-01',
    });
    await h.sql(`UPDATE publishers SET service_group_id = $1 WHERE id = $2`, [
      groupId,
      anna,
    ]);
    await h.sql(`UPDATE publishers SET appointment = 'elder' WHERE id = $1`, [
      peter,
    ]);
    await h.addUser({ login: 'anna', role: 'publisher', publisherId: anna });
    await h.addUser({ login: 'lena', role: 'publisher', publisherId: lena });
    await h.addUser({ login: 'peter', role: 'elder', publisherId: peter });
    await h.addUser({ login: 'nobody', role: 'publisher' });
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    for (const t of [
      'assignments',
      'duties',
      'cleaning_assignments',
      'absences',
      'meeting_moves',
      'memorial_items',
      'elders_meetings',
      'talk_exchange',
      'external_congregations',
    ]) {
      await h.sql(`DELETE FROM ${t} WHERE congregation_id = $1`, [tenant]);
    }
    await h.sql(`DELETE FROM special_events WHERE congregation_id = $1`, [
      tenant,
    ]);
  });

  it('an ordinary week: the meeting’s day, hour, an hour and three quarters, the hall', async () => {
    const id = await part(W1, 'midweek', 'bible_reading', anna, {
      title: 'Чтение Библии: Иеремия 51:1—14',
    });
    const [it] = await agenda('anna');
    expect(it).toMatchObject({
      id: `part:${id}`,
      kind: 'part',
      date: '2027-03-03',
      start: '19:00',
      end: '20:45',
      title: 'Чтение Библии',
      detail: 'Иеремия 51:1—14',
      meetingKey: 'midweek:2027-03-03',
      meeting: 'midweek',
      place: 'Lindenstraße 12, Nordwald',
      state: 'ok',
      notHeldReason: null,
    });
  });

  it('a draft, a cancelled line and a removed one are nobody’s business yet', async () => {
    await part(W1, 'midweek', 'bible_reading', anna, { status: 'draft' });
    await part(W1, 'weekend', 'watchtower_reader', anna, {
      status: 'cancelled',
    });
    const gone = await part(W1, 'midweek', 'apply_yourself_1', anna);
    await h.sql(`UPDATE assignments SET deleted_at = now() WHERE id = $1`, [
      gone,
    ]);
    expect(await agenda('anna')).toEqual([]);
  });

  it('a meeting moved for one week: its new day and hour', async () => {
    await part(W2, 'midweek', 'bible_reading', anna);
    await h.sql(
      `INSERT INTO meeting_moves (congregation_id, week_start_date, event_type, date, time)
       VALUES ($1, $2, 'midweek', '2027-03-08', '18:30')`,
      [tenant, W2],
    );
    const [it] = await agenda('anna');
    expect([it.date, it.start, it.end]).toEqual([
      '2027-03-08',
      '18:30',
      '20:15',
    ]);
    expect(it.meetingKey).toBe('midweek:2027-03-08');
  });

  it('a circuit overseer’s week: the midweek meeting on the Tuesday', async () => {
    await event('circuit_overseer_visit', '2027-03-16', {
      end_date: '2027-03-21',
    });
    await part(W3, 'midweek', 'bible_reading', anna);
    const items = await agenda('anna');
    expect(items.find((i) => i.kind === 'part')?.date).toBe('2027-03-16');
    // The visit itself is there for everybody, across its days.
    expect(items.find((i) => i.kind === 'event')).toMatchObject({
      scope: 'event',
      date: '2027-03-16',
      endDate: '2027-03-21',
      start: null,
      title: 'Посещение районного старейшины',
      state: 'ok',
    });
  });

  it('a convention week: the part stands, marked not held — and no cleaning after it', async () => {
    await event('regional_convention', '2027-03-26', {
      end_date: '2027-03-28',
    });
    await part(W4, 'weekend', 'watchtower_reader', anna);
    await h.sql(
      `INSERT INTO cleaning_assignments (congregation_id, week_start_date, slot_type, service_group_id)
       VALUES ($1, $2, 'after_meeting', $3), ($1, $4, 'after_meeting', $3)`,
      [tenant, W4, groupId, W1],
    );
    const items = await agenda('anna');
    const p = items.find((i) => i.kind === 'part')!;
    expect(p).toMatchObject({
      state: 'not_held',
      notHeldReason: 'congress',
      start: null,
      place: null,
    });
    const cleaning = items.filter((i) => i.kind === 'cleaning');
    // Only the ordinary week's two meetings — right after each.
    expect(cleaning.map((c) => [c.date, c.start])).toEqual([
      ['2027-03-03', '20:45'],
      ['2027-03-07', '11:45'],
    ]);
  });

  it('the Memorial takes the midweek meeting; its own lines only once its programme is out', async () => {
    const memorial = await event('memorial', '2027-04-08', {
      time: '19:30',
      address: 'Lindenstraße 12, Nordwald',
    });
    await part(W5, 'midweek', 'bible_reading', anna);
    await h.sql(
      `INSERT INTO memorial_items (congregation_id, special_event_id, section, label, publisher_id)
       VALUES ($1, $2, 'program', 'Вступительная молитва', $3)`,
      [tenant, memorial, peter],
    );
    await h.sql(
      `INSERT INTO duties (congregation_id, week_start_date, event_type, duty_type, slot_index, publisher_id)
       VALUES ($1, $2, 'memorial', 'attendant', 0, $3)`,
      [tenant, W5, anna],
    );
    const before = await agenda('anna');
    expect(before.find((i) => i.kind === 'part')).toMatchObject({
      state: 'not_held',
      notHeldReason: 'memorial',
    });
    // Not published yet: her duty that evening is not in the agenda.
    expect(before.some((i) => i.kind === 'duty')).toBe(false);
    expect((await agenda('peter')).some((i) => i.kind === 'part')).toBe(false);

    await h.sql(
      `UPDATE special_events SET memorial_published_at = now() WHERE id = $1`,
      [memorial],
    );
    const duty = (await agenda('anna')).find((i) => i.kind === 'duty')!;
    expect(duty).toMatchObject({
      date: '2027-04-08',
      start: '19:30',
      meetingKey: `memorial:${memorial}`,
      title: 'Распорядитель в зале',
    });
    const peters = await agenda('peter');
    const line = peters.find((i) => i.kind === 'part')!;
    expect(line).toMatchObject({
      title: 'Вступительная молитва',
      meeting: 'memorial',
      meetingKey: `memorial:${memorial}`,
    });
    // The Memorial's event carries the same key, so a calendar shows it once.
    expect(peters.find((i) => i.kind === 'event')?.meetingKey).toBe(
      `memorial:${memorial}`,
    );
  });

  it('a day away marks what falls on it, and nothing else', async () => {
    await part(W6, 'midweek', 'bible_reading', anna);
    await part(W6, 'weekend', 'watchtower_reader', anna);
    await h.sql(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date)
       VALUES ($1, $2, '2027-04-14', NULL)`,
      [tenant, anna],
    );
    const items = await agenda('anna');
    expect(items.map((i) => [i.date, i.state])).toEqual([
      ['2027-04-14', 'away'],
      ['2027-04-18', 'ok'],
    ]);
  });

  it('the partner by name, both ways', async () => {
    const id = await part(W1, 'midweek', 'apply_yourself_1', anna, {
      assistant: lena,
      title: 'Начинайте разговор: дом за домом',
    });
    const [mine] = await agenda('anna');
    expect(mine).toMatchObject({
      id: `part:${id}`,
      title: 'Начинайте разговор',
      with: ['Лена Кляйн'],
      asAssistant: false,
    });
    const [hers] = await agenda('lena');
    expect(hers).toMatchObject({
      id: `part:${id}:assistant`,
      title: 'Начинайте разговор (помощник)',
      with: ['Анна Берг'],
      asAssistant: true,
    });
  });

  it('a partner changed: the same item, the new name', async () => {
    const id = await part(W1, 'midweek', 'apply_yourself_1', anna, {
      assistant: lena,
    });
    const before = (await agenda('anna'))[0];
    await h.sql(
      `UPDATE assignments SET assistant_publisher_id = $1 WHERE id = $2`,
      [peter, id],
    );
    const after = (await agenda('anna'))[0];
    expect(after.id).toBe(before.id);
    expect(after.with).toEqual(['Петер Шульц']);
  });

  it('a talk elsewhere is not «away» by its own absence — the meeting at home is', async () => {
    const [{ id: host }] = await h.sql<{ id: string }>(
      `INSERT INTO external_congregations (congregation_id, name, address, meeting_time)
       VALUES ($1, 'Westhafen', 'Hafenweg 3', '13:00') RETURNING id`,
      [tenant],
    );
    const [{ id: talk }] = await h.sql<{ id: string }>(
      `INSERT INTO talk_exchange (congregation_id, direction, date, publisher_id, host_congregation_id)
       VALUES ($1, 'outgoing', '2027-03-07', $2, $3) RETURNING id`,
      [tenant, peter, host],
    );
    await h.sql(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, talk_exchange_id)
       VALUES ($1, $2, '2027-03-07', $3)`,
      [tenant, peter, talk],
    );
    await part(W1, 'weekend', 'weekend_closing_prayer', peter);
    const items = await agenda('peter');
    expect(items.find((i) => i.kind === 'outgoing_talk')).toMatchObject({
      id: `outgoing_talk:${talk}`,
      date: '2027-03-07',
      start: '13:00',
      end: '14:45',
      title: 'Речь на выезде — собрание Westhafen',
      place: 'Hafenweg 3',
      state: 'ok',
    });
    expect(items.find((i) => i.kind === 'part')?.state).toBe('away');
  });

  it('the elders’ meeting: for an elder, with day and hour only; not for a sister', async () => {
    await h.sql(
      `INSERT INTO elders_meetings (congregation_id, date, start_time, note, place_text)
       VALUES ($1, '2027-03-10', '17:30', 'секретная заметка', 'Зал, комната 2')`,
      [tenant],
    );
    const [it] = (await agenda('peter')).filter(
      (i) => i.kind === 'elders_meeting',
    );
    expect(it).toMatchObject({
      date: '2027-03-10',
      start: '17:30',
      title: 'Встреча старейшин',
      place: 'Зал, комната 2',
      detail: null,
    });
    expect(JSON.stringify(it)).not.toContain('секретная');
    expect(
      (await agenda('anna')).some((i) => i.kind === 'elders_meeting'),
    ).toBe(false);
  });

  it('the brother who hosts the circuit overseer: the visit once, as his own', async () => {
    const visit = await event('circuit_overseer_visit', '2027-03-16', {
      end_date: '2027-03-21',
      co_accommodation_publisher_id: peter,
    });
    const his = (await agenda('peter')).filter((i) => i.id.includes(visit));
    expect(his).toHaveLength(1);
    expect(his[0]).toMatchObject({
      scope: 'mine',
      title: 'Посещение районного старейшины — живёт у вас',
      date: '2027-03-16',
      endDate: '2027-03-21',
    });
    // Everybody else: the visit as the congregation's event.
    const hers = (await agenda('anna')).filter((i) => i.id.includes(visit));
    expect(hers.map((i) => [i.scope, i.title])).toEqual([
      ['event', 'Посещение районного старейшины'],
    ]);
  });

  it('big events only: a campaign or «other» is not one', async () => {
    await event('branch_representative_visit', '2027-04-20', { time: '10:00' });
    await event('campaign', '2027-04-01', { end_date: '2027-04-30' });
    await event('other', '2027-04-21');
    const events = (await agenda('anna')).filter((i) => i.kind === 'event');
    expect(events.map((e) => e.eventType)).toEqual([
      'branch_representative_visit',
    ]);
    expect(events[0]).toMatchObject({ start: '10:00', endDate: null });
  });

  it('stable ids: the same agenda twice is the same, item for item', async () => {
    await part(W1, 'midweek', 'bible_reading', anna);
    await part(W1, 'weekend', 'watchtower_reader', anna);
    const a = await agenda('anna');
    const b = await agenda('anna');
    expect(b).toEqual(a);
  });

  it('a login with no card: an empty agenda, not an error', async () => {
    const r = await h.as('nobody').get('/me/agenda');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ publisherId: null, items: [] });
  });

  it('a nonsense date is refused, and nobody reads it anonymously', async () => {
    expect((await h.as('anna').get('/me/agenda?from=2027-13-01')).status).toBe(
      400,
    );
    expect((await h.as(null).get('/me/agenda')).status).toBe(401);
  });
});
