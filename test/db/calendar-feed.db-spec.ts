import { Harness, startHarness } from './harness';

/**
 * The calendar link (7 November 2026), end to end: connecting, the feed a
 * calendar reads, «nothing new» by ETag, a new link, off — and the link dying
 * with the sessions when somebody else sets the password.
 */
describe('calendar feed (real database)', () => {
  let h: Harness;
  let tenant = '';
  let anna = '';
  let annaUser = '';

  const tokenOf = (url: string) =>
    /\/calendar\/([A-Za-z0-9_-]{43})\.ics$/.exec(url)![1];
  const feed = (token: string, headers: Record<string, string> = {}) => {
    const t = h.as(null).get(`/calendar/${token}.ics`);
    for (const [k, v] of Object.entries(headers)) t.set(k, v);
    return t;
  };
  type View = {
    connected: boolean;
    url: string | null;
    webcalUrl: string | null;
    options: { mine: boolean; events: boolean; names: boolean };
    lastFetchedAt: string | null;
    lastClient: string | null;
    revokedReason: string | null;
  };
  const connect = async (): Promise<View> => {
    const r = await h.as('anna').post('/me/calendar-feed');
    expect(r.status).toBe(200);
    return r.body as View;
  };

  beforeAll(async () => {
    h = await startHarness();
    [{ id: tenant }] = await h.sql<{ id: string }>(
      `SELECT id FROM congregations LIMIT 1`,
    );
    const s = await h.as('admin').post('/meeting-settings', {
      effectiveFrom: '2026-01-05',
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '10:00',
      address: 'Lindenstraße 12, Nordwald',
      confirmPast: true,
    });
    expect([200, 201]).toContain(s.status);
    anna = await h.addPublisher({
      firstName: 'Анна',
      lastName: 'Берг',
      gender: 'sister',
      baptismDate: '2015-01-01',
    });
    const lena = await h.addPublisher({
      firstName: 'Лена',
      lastName: 'Кляйн',
      gender: 'sister',
      baptismDate: '2016-01-01',
    });
    annaUser = await h.addUser({
      login: 'anna',
      role: 'publisher',
      publisherId: anna,
    });
    // Next Monday and the one after: inside the year the feed covers.
    const [{ week }] = await h.sql<{ week: string }>(
      `SELECT to_char(date_trunc('week', now() + interval '7 days'), 'YYYY-MM-DD') AS week`,
    );
    await h.sql(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, part_title, publisher_id, assistant_publisher_id, status)
       VALUES ($1, $2, 'midweek', 'apply_yourself_1', 'Начинайте разговор: дом за домом', $3, $4, 'published')`,
      [tenant, week, anna, lena],
    );
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    await h.sql(`DELETE FROM calendar_feeds WHERE congregation_id = $1`, [
      tenant,
    ]);
    await h.sql(
      `DELETE FROM calendar_feed_retired WHERE congregation_id = $1`,
      [tenant],
    );
  });

  it('before connecting: not connected, no link', async () => {
    const r = await h.as('anna').get('/me/calendar-feed');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ connected: false, url: null });
  });

  it('connect: a link of 43 secret characters; pressing again gives the same link', async () => {
    const a = await connect();
    expect(a.connected).toBe(true);
    expect(a.url).toMatch(/\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    expect(a.webcalUrl).toMatch(/^webcal:\/\//);
    // The same secret (the test server answers on a new port each time).
    expect(tokenOf((await connect()).url!)).toBe(tokenOf(a.url!));
    // The link points at the host the app reached, not at the website.
    expect(a.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/calendar\//);
    // Only the hash is findable; the token itself is not stored in the clear.
    const [row] = await h.sql<{ token: string; token_hash: string }>(
      `SELECT token, token_hash FROM calendar_feeds WHERE user_id = $1`,
      [annaUser],
    );
    expect(row.token).not.toContain(tokenOf(a.url!));
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the feed: a calendar with her part, the partner, no alarms', async () => {
    const token = tokenOf((await connect()).url!);
    const r = await feed(token, { 'User-Agent': 'Google-Calendar-Importer' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    const text = r.text.replace(/\r\n /g, '');
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('Начинайте разговор — встреча буднего дня');
    expect(text).toContain('вместе: Лена Кляйн');
    expect(text).not.toContain('VALARM');
    // The screen can now say who read it and when.
    const v = (await h.as('anna').get('/me/calendar-feed')).body as View;
    expect(v.lastClient).toBe('google');
    expect(v.lastFetchedAt).not.toBeNull();
  });

  /** What a phone gets from a link that WAS real and no longer works. */
  const expectNotice = (r: { status: number; text: string }) => {
    expect(r.status).toBe(200);
    expect(r.text).toContain('UID:link-off@mycongregation.org');
    expect(r.text).toContain('Календарь собрания отключён');
    // Nothing of hers: not the part, not the partner.
    expect(r.text).not.toContain('Начинайте');
    expect(r.text).not.toContain('Лена');
    expect(r.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  };

  it('always the whole text, made now — no 304 that would keep an old «as of»', async () => {
    const token = tokenOf((await connect()).url!);
    const first = await feed(token);
    const again = await feed(token, {
      'If-None-Match': String(first.headers['etag'] ?? '"x"'),
    });
    expect(again.status).toBe(200);
    expect(again.text).toContain('BEGIN:VCALENDAR');
    expect(again.headers['cache-control']).toBe('private, no-store');
  });

  it('names switched off: the partner is gone from the feed', async () => {
    const token = tokenOf((await connect()).url!);
    const p = await h.as('anna').patch('/me/calendar-feed', { names: false });
    expect(p.status).toBe(200);
    expect((p.body as View).options).toEqual({
      mine: true,
      events: true,
      names: false,
    });
    const after = await feed(token);
    expect(after.status).toBe(200);
    expect(after.text).not.toContain('Лена');
  });

  it('a new link: the old one only says it is switched off; the new one works', async () => {
    const old = tokenOf((await connect()).url!);
    const r = await h.as('anna').post('/me/calendar-feed/rotate');
    expect(r.status).toBe(200);
    const fresh = tokenOf((r.body as View).url!);
    expect(fresh).not.toBe(old);
    expectNotice(await feed(old));
    expect((await feed(fresh)).text).toContain('Начинайте');
  });

  it('off: the link only says it is switched off', async () => {
    const token = tokenOf((await connect()).url!);
    expect((await h.as('anna').delete('/me/calendar-feed')).status).toBe(200);
    expectNotice(await feed(token));
    expect((await h.as('anna').get('/me/calendar-feed')).body).toMatchObject({
      connected: false,
    });
  });

  it('a password set by an administrator ends the link with the sessions — the screen says why, reconnecting gives a new link', async () => {
    const token = tokenOf((await connect()).url!);
    const r = await h.as('admin').post(`/users/${annaUser}/reset-password`, {
      password: 'Another-Pass-77x!',
    });
    expect(r.status).toBe(204);
    expectNotice(await feed(token));
    const v = (await h.as('anna').get('/me/calendar-feed')).body as View;
    expect(v).toMatchObject({
      connected: false,
      url: null,
      revokedReason: 'sessions_ended',
    });
    const again = tokenOf((await connect()).url!);
    expect(again).not.toBe(token);
    expectNotice(await feed(token));
    expect((await feed(again)).text).toContain('Начинайте');
  });

  it('a switched-off login: the notice, nothing of the person', async () => {
    const token = tokenOf((await connect()).url!);
    await h.sql(`UPDATE users SET is_active = false WHERE id = $1`, [annaUser]);
    try {
      expectNotice(await feed(token));
    } finally {
      await h.sql(`UPDATE users SET is_active = true WHERE id = $1`, [
        annaUser,
      ]);
    }
  });

  it('a retired link is forgotten after half a year: then a plain 404', async () => {
    const token = tokenOf((await connect()).url!);
    await h.as('anna').delete('/me/calendar-feed');
    await h.sql(
      `UPDATE calendar_feed_retired SET retired_at = now() - interval '200 days'`,
    );
    // The next retirement sweeps the old ones.
    await connect();
    await h.as('anna').post('/me/calendar-feed/rotate');
    expect((await feed(token)).status).toBe(404);
  });

  it('a wrong token, a malformed one, no extension: the same plain 404', async () => {
    const token = tokenOf((await connect()).url!);
    const wrong = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    for (const t of [wrong, 'short', '../../etc/passwd']) {
      const r = await feed(t);
      expect(r.status).toBe(404);
    }
    // Without «.ics» the link still works: some calendars strip it.
    expect((await h.as(null).get(`/calendar/${token}`)).status).toBe(200);
  });

  it('the limit follows the link, not the address: another link from the same address still works', async () => {
    const token = tokenOf((await connect()).url!);
    let limited = false;
    for (let i = 0; i < 12; i++) {
      if ((await feed(token)).status === 429) limited = true;
    }
    expect(limited).toBe(true);
    // Another person's link, from the same test address, is not held up.
    await h.addUser({ login: 'lena', role: 'publisher' });
    const lr = await h.as('lena').post('/me/calendar-feed');
    expect(lr.status).toBe(200);
    expect((await feed(tokenOf((lr.body as View).url!))).status).toBe(200);
  });
});
