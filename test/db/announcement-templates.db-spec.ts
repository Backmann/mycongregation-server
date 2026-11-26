import { Harness, startHarness } from './harness';
import { DataSource } from 'typeorm';
import { MeetingAnnouncement } from '../../src/entities/meeting-announcement.entity';
import { ConventionRulesService } from '../../src/announcements/convention-rules.service';

/**
 * THE «TEMPLATES» SCREEN (announcements R-09 step 4) on a real database: who
 * may change it, what it refuses, and that the suggestions and the
 * chairman's item obey it.
 */
type Who = 'admin' | 'bc' | 'elder' | 'pub';
const WHO: Who[] = ['admin', 'bc', 'elder', 'pub'];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDays(iso, 1 - dow);
}

describe('announcement templates (real database)', () => {
  let h: Harness;
  let tenant: string;
  const login = (w: Who) => (w === 'admin' ? 'admin' : `tpl${w}user`);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
  }).format(new Date());
  const THIS = monday(today);
  const WEEK = addDays(THIS, 7);
  const ASSEMBLY = addDays(THIS, 20);

  const patch = (w: Who, key: string, body: object) =>
    h.as(login(w)).patch(`/announcements/templates/${key}`, body);
  const offered = async () =>
    (await h.as(login('bc')).get(`/announcements/suggestions?week=${WEEK}`))
      .body.items as { key: string; text: string }[];

  beforeAll(async () => {
    h = await startHarness();
    tenant = (
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
        lastName: 'Шаблоны',
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
    await person('elder', 'elder');
    await person('pub', 'publisher');
    for (const [type, date, time] of [
      ['general_cleaning', addDays(WEEK, 5), '09:00'],
      ['circuit_assembly', ASSEMBLY, null],
    ]) {
      const r = await h
        .as('admin')
        .post('/special-events', { type, title: String(type), date, time });
      expect(r.status).toBe(201);
    }
  });
  afterAll(async () => {
    await h?.close();
  });

  it('only the writers read and change it', async () => {
    const read: Record<string, number> = {};
    const write: Record<string, number> = {};
    for (const w of WHO) {
      read[w] = (await h.as(login(w)).get('/announcements/templates')).status;
      write[w] = (await patch(w, 'accounts_month', { enabled: true })).status;
    }
    expect(read).toEqual({ admin: 200, bc: 200, elder: 403, pub: 403 });
    expect(write).toEqual({ admin: 200, bc: 200, elder: 403, pub: 403 });
  });

  it('lists every template with the app’s words and weeks', async () => {
    const list = (await h.as(login('bc')).get('/announcements/templates')).body;
    const memorial = list.find(
      (t: { key: string }) => t.key === 'memorial.ahead',
    );
    expect(memorial).toEqual(
      expect.objectContaining({
        enabled: true,
        words: null,
        defaultWeeks: 5,
        weeksAhead: null,
        tokens: ['when'],
      }),
    );
    expect(memorial.defaultWords).toContain('{when}');
  });

  it('refuses a placeholder it does not know, words where there are none, weeks out of range', async () => {
    const bad = await patch('bc', 'general_cleaning', {
      words: '{when} {dtae}',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('ANNOUNCEMENT_TEMPLATE_TOKEN');
    expect((await patch('bc', 'field_service', { words: 'x' })).status).toBe(
      400,
    );
    expect(
      (await patch('bc', 'memorial.ahead', { weeksAhead: 30 })).status,
    ).toBe(400);
    expect(
      (await patch('bc', 'general_cleaning', { weeksAhead: 3 })).status,
    ).toBe(400);
    expect((await patch('bc', 'nonsense', { enabled: false })).status).toBe(
      400,
    );
  });

  it('its own words reach the suggestion; empty words bring back the app’s', async () => {
    const own = await patch('bc', 'general_cleaning', {
      words: '{when}: уборка зала, приходите все.',
    });
    expect(own.status).toBe(200);
    const s = (await offered()).find((x) =>
      x.key.startsWith('general_cleaning:'),
    );
    expect(s?.text).toMatch(
      /^Суббота, .*, 9:00: уборка зала, приходите все\.$/,
    );
    expect((await patch('bc', 'general_cleaning', { words: '' })).status).toBe(
      200,
    );
    const back = (await offered()).find((x) =>
      x.key.startsWith('general_cleaning:'),
    );
    expect(back?.text).toContain('генеральная уборка Зала царства');
  });

  it('turned off, it is not offered', async () => {
    expect(
      (await patch('bc', 'general_cleaning', { enabled: false })).status,
    ).toBe(200);
    expect((await offered()).map((x) => x.key)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^general_cleaning:/)]),
    );
    await patch('bc', 'general_cleaning', { enabled: true });
  });

  it('turned off after one was added: the added one is not «gone»', async () => {
    const s0 = (await offered()).find((x) =>
      x.key.startsWith('general_cleaning:'),
    )!;
    const took = await h
      .as(login('bc'))
      .post('/announcements/suggestions/take', {
        weekStartDate: WEEK,
        key: s0.key,
        kinds: ['midweek'],
        text: 'Уборка',
      });
    expect(took.status).toBe(201);
    await patch('bc', 'general_cleaning', { enabled: false });
    const week = (
      await h.as(login('bc')).get(`/announcements/suggestions?week=${WEEK}`)
    ).body;
    expect(week.stale).toEqual([]);
    const summary = (
      await h.as(login('bc')).get('/announcements/suggestions/summary')
    ).body;
    expect(summary.stale).toBe(0);
    await patch('bc', 'general_cleaning', { enabled: true });
  });

  it('refuses «enabled: null» and one week ahead; null weeks bring back the app’s', async () => {
    expect(
      (await patch('bc', 'memorial.ahead', { enabled: null })).status,
    ).toBe(400);
    expect(
      (await patch('bc', 'memorial.ahead', { weeksAhead: 1 })).status,
    ).toBe(400);
    expect(
      (await patch('bc', 'memorial.ahead', { weeksAhead: 3 })).body.weeksAhead,
    ).toBe(3);
    expect(
      (await patch('bc', 'memorial.ahead', { weeksAhead: null })).body
        .weeksAhead,
    ).toBeNull();
  });

  it('a change that changes nothing writes nothing in the journal', async () => {
    const count = async () =>
      Number(
        (
          await h.sql<{ n: string }>(
            `SELECT count(*) AS n FROM audit_logs WHERE congregation_id = $1 AND entity_type = 'announcement_template'`,
            [tenant],
          )
        )[0].n,
      );
    await patch('bc', 'accounts_audit', { enabled: true });
    const before = await count();
    await patch('bc', 'accounts_audit', { enabled: true });
    expect(await count()).toBe(before);
    await patch('bc', 'accounts_audit', { enabled: false });
    expect(await count()).toBe(before + 1);
    await patch('bc', 'accounts_audit', { enabled: true });
  });

  it('the programme on the screens turned off: what was placed stays, nothing new is placed', async () => {
    const count = async () => {
      const [r] = await h.sql<{ items: number; tasks: number }>(
        `SELECT (SELECT count(*)::int FROM meeting_announcements WHERE congregation_id = $1 AND source = 'assembly_screens') AS items,
                (SELECT count(*)::int FROM elder_tasks WHERE congregation_id = $1 AND kind = 'assembly_screens') AS tasks`,
        [tenant],
      );
      return [r.items, r.tasks];
    };
    const tick = () =>
      h.app.get(ConventionRulesService).forCongregation(tenant);
    // What earlier tests placed: switching off keeps it.
    await tick();
    const before = await count();
    expect(before[0]).toBeGreaterThan(0);
    expect(
      (await patch('bc', 'assembly_screens', { enabled: false })).status,
    ).toBe(200);
    await tick();
    expect(await count()).toEqual(before);
    // A clean slate: with the switch off, nothing at all is placed.
    await h.sql(
      `DELETE FROM meeting_announcements WHERE congregation_id = $1 AND source = 'assembly_screens'`,
      [tenant],
    );
    await h.sql(
      `DELETE FROM elder_tasks WHERE congregation_id = $1 AND kind = 'assembly_screens'`,
      [tenant],
    );
    await h.sql(
      `DELETE FROM elder_task_calendar_log WHERE congregation_id = $1 AND kind = 'assembly_screens'`,
      [tenant],
    );
    await h.sql(
      `DELETE FROM announcement_dismissals WHERE congregation_id = $1 AND source_key LIKE 'rule:assembly_screens:%'`,
      [tenant],
    );
    await tick();
    expect(await count()).toEqual([0, 0]);
    // On again, with own words: placed again, one item and one task per event.
    expect(
      (
        await patch('bc', 'assembly_screens', {
          enabled: true,
          words: 'Покажите программу конгресса.\n{program}',
        })
      ).status,
    ).toBe(200);
    await tick();
    const after = await count();
    expect(after[0]).toBeGreaterThan(0);
    expect(after[1]).toBe(after[0]);
    const words = await h.app
      .get(DataSource)
      .getRepository(MeetingAnnouncement)
      .findBy({ congregationId: tenant, source: 'assembly_screens' });
    expect(
      words.every((w) => w.text.startsWith('Покажите программу конгресса.')),
    ).toBe(true);
  });

  it('the campaign part turned off: no task', async () => {
    await h.as('admin').post('/special-events', {
      type: 'regional_convention',
      title: 'regional',
      date: addDays(today, 40),
    });
    expect(
      (await patch('bc', 'campaign_part', { enabled: false })).status,
    ).toBe(200);
    await h.app.get(ConventionRulesService).forCongregation(tenant);
    expect(
      await h.sql(
        `SELECT 1 FROM elder_tasks WHERE congregation_id = $1 AND kind = 'campaign_part'`,
        [tenant],
      ),
    ).toEqual([]);
    await patch('bc', 'campaign_part', { enabled: true });
    await h.app.get(ConventionRulesService).forCongregation(tenant);
    expect(
      await h.sql(
        `SELECT 1 FROM elder_tasks WHERE congregation_id = $1 AND kind = 'campaign_part'`,
        [tenant],
      ),
    ).toHaveLength(1);
  });
});
