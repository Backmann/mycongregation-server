import { Harness, startHarness } from './harness';

/**
 * The congregation's places at its meetings (Lionel, 27 October 2026): kept
 * once, cut into every new sheet, followed by the sheets still ahead — and a
 * person is never taken off a place by a change of the template.
 */
describe('duty places and the month of duties (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let brother: string;

  /** Monday `weeks` from this one. */
  const monday = (weeks: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7 * weeks);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  /** Wednesday of that week — the midweek meeting here. */
  const wednesday = (week: string) => {
    const d = new Date(`${week}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 2);
    return d.toISOString().slice(0, 10);
  };
  const sheet = async (week: string) =>
    h.sql<{
      duty_type: string;
      custom_label: string | null;
      slot_index: number;
      sort_order: number;
      publisher_id: string | null;
    }>(
      `SELECT duty_type, custom_label, slot_index, sort_order, publisher_id
         FROM duties WHERE week_start_date = $1 AND event_type = 'midweek'
        ORDER BY sort_order, slot_index`,
      [week],
    );
  const generate = (week: string) =>
    h
      .as('admin')
      .post('/duties/generate', { weekStartDate: week, eventType: 'midweek' });

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenantId }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    await h.sql(
      `INSERT INTO meeting_settings (congregation_id, effective_from, midweek_dow, midweek_time, weekend_dow, weekend_time, address, microphone_slots)
       VALUES ($1, '2020-01-01', 3, '19:00', 7, '10:00', 'Saal', 2)`,
      [tenantId],
    );
    brother = await h.addPublisher({
      firstName: 'Петер',
      lastName: 'Шмидт',
      appointment: 'publisher',
      baptismDate: '2000-01-01',
      capabilities: { duty_security: true },
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('while nothing is kept, the places are the code’s list', async () => {
    const r = await h.as('admin').get('/duties/places/midweek');
    expect(r.status).toBe(200);
    expect(r.body.stored).toBe(false);
    expect(
      r.body.places.map((p: { dutyType: string; count: number }) => [
        p.dutyType,
        p.count,
      ]),
    ).toEqual([
      ['security', 1],
      ['attendant', 1],
      ['microphone', 2],
      ['av', 1],
      ['zoom', 1],
      ['stage', 1],
      ['ventilation', 1],
      ['timekeeper', 1],
    ]);
  });

  it('a change reaches the sheets ahead, keeps the person, and leaves the past alone', async () => {
    const ahead = monday(2);
    const past = monday(-2);
    expect((await generate(ahead)).status).toBe(201);
    const [security] = await h.sql<{ id: string }>(
      `SELECT id FROM duties WHERE week_start_date = $1 AND duty_type = 'security'`,
      [ahead],
    );
    expect(
      (
        await h
          .as('admin')
          .patch(`/duties/${security.id}/assign`, { publisherId: brother })
      ).status,
    ).toBe(200);
    await h.sql(
      `INSERT INTO duties (congregation_id, week_start_date, event_type, duty_type, slot_index, sort_order)
       VALUES ($1, $2, 'midweek', 'zoom', 0, 1)`,
      [tenantId, past],
    );

    const places = [
      { dutyType: 'attendant', count: 1 },
      {
        dutyType: 'custom',
        customLabel: 'Стоянка',
        count: 2,
        notes: 'жилетки в шкафу',
        capability: 'duty_attendant',
      },
      { dutyType: 'microphone', count: 3 },
      { dutyType: 'av', count: 1 },
    ];
    const preview = await h
      .as('admin')
      .post('/duties/places/midweek/preview', { places });
    expect(preview.status).toBe(201);
    expect(preview.body.meetings).toBe(1);
    expect(preview.body.kept).toEqual([
      expect.objectContaining({
        weekStartDate: ahead,
        dutyType: 'security',
        publisherId: brother,
        publisherName: 'Шмидт Петер',
      }),
    ]);
    // The preview writes nothing.
    expect((await sheet(ahead)).length).toBe(9);

    const save = await h.as('admin').put('/duties/places/midweek', { places });
    expect(save.status).toBe(200);

    const rows = await sheet(ahead);
    expect(
      rows.map((r) => [
        r.duty_type,
        r.custom_label,
        r.slot_index,
        r.sort_order,
      ]),
    ).toEqual([
      ['attendant', null, 0, 1],
      ['custom', 'Стоянка', 0, 2],
      ['custom', 'Стоянка', 1, 2],
      ['microphone', null, 0, 3],
      ['microphone', null, 1, 3],
      ['microphone', null, 2, 3],
      ['av', null, 0, 4],
      // Removed from the template, but somebody stands there.
      ['security', null, 0, 5],
    ]);
    expect(rows.find((r) => r.duty_type === 'security')?.publisher_id).toBe(
      brother,
    );
    expect((await sheet(past)).map((r) => r.duty_type)).toEqual(['zoom']);
  });

  it('a new sheet is cut from the kept places', async () => {
    const week = monday(3);
    expect((await generate(week)).status).toBe(201);
    expect(
      (await sheet(week)).map((r) => r.custom_label ?? r.duty_type),
    ).toEqual([
      'attendant',
      'Стоянка',
      'Стоянка',
      'microphone',
      'microphone',
      'microphone',
      'av',
    ]);
  });

  it('a rename follows the rows, the people included', async () => {
    const got = await h.as('admin').get('/duties/places/midweek');
    expect(got.body.stored).toBe(true);
    const places = got.body.places.map((p: { customLabel: string | null }) =>
      p.customLabel === 'Стоянка' ? { ...p, customLabel: 'Парковка' } : p,
    );
    expect(
      (await h.as('admin').put('/duties/places/midweek', { places })).status,
    ).toBe(200);
    const labels = (await sheet(monday(3)))
      .map((r) => r.custom_label)
      .filter(Boolean);
    expect(labels).toEqual(['Парковка', 'Парковка']);
  });

  it('refuses a template it could not keep', async () => {
    const r = await h.as('admin').put('/duties/places/midweek', {
      places: [
        { dutyType: 'av', count: 1 },
        { dutyType: 'av', count: 1 },
      ],
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('DUTY_PLACES_INVALID');
  });

  it('a cell of the month: the sheet is cut and the place filled, with its warnings', async () => {
    const week = monday(5);
    const r = await h.as('admin').post('/duties/assign-place', {
      weekStartDate: week,
      eventType: 'midweek',
      dutyType: 'custom',
      customLabel: 'Парковка',
      ordinal: 1,
      publisherId: brother,
    });
    expect(r.status).toBe(201);
    // His card has the entrance, not the attendants the place asks for.
    expect(r.body.warnings).toEqual(['capability_off']);
    const rows = await sheet(week);
    expect(
      rows
        .filter((x) => x.custom_label === 'Парковка')
        .map((x) => x.publisher_id),
    ).toEqual([null, brother]);
  });

  it('the month: sheets where made, places where not, and who carries what', async () => {
    const week = monday(5);
    const month = wednesday(week).slice(0, 7);
    const r = await h.as('admin').get(`/duties/month?month=${month}`);
    expect(r.status).toBe(200);
    const meetings = r.body.meetings as {
      weekStartDate: string;
      eventType: string;
      held: boolean;
      hasSheet: boolean;
      rows: { id: string | null; customLabel: string | null }[];
    }[];
    const made = meetings.find(
      (m) => m.weekStartDate === week && m.eventType === 'midweek',
    );
    expect(made?.hasSheet).toBe(true);
    const weekend = meetings.find(
      (m) => m.weekStartDate === week && m.eventType === 'weekend',
    );
    if (weekend) {
      // Nobody opened it: the code's list, unsaved.
      expect(weekend.hasSheet).toBe(false);
      expect(weekend.rows.every((x) => x.id === null)).toBe(true);
    }
    const mine = (
      r.body.load as { publisherId: string; duties: number }[]
    ).find((l) => l.publisherId === brother);
    expect(mine?.duties).toBeGreaterThanOrEqual(1);
    expect(
      (await h.as('admin').get('/duties/month?month=2026-13')).status,
    ).toBe(400);
  });

  it('the month says how far each meeting’s programme is filled', async () => {
    const week = monday(6);
    await h.sql(
      `INSERT INTO assignments (congregation_id, week_start_date, event_type, part_key, publisher_id)
       VALUES ($1, $2, 'midweek', 'midweek_chairman', $3),
              ($1, $2, 'midweek', 'bible_reading', NULL)`,
      [tenantId, week, brother],
    );
    const month = wednesday(week).slice(0, 7);
    const r = await h.as('admin').get(`/duties/month?month=${month}`);
    const m = (
      r.body.meetings as {
        weekStartDate: string;
        eventType: string;
        programme: { loaded: boolean; assigned: number; total: number } | null;
      }[]
    ).find((x) => x.weekStartDate === week && x.eventType === 'midweek');
    expect(m?.programme).toEqual(
      expect.objectContaining({ loaded: true, assigned: 1, total: 2 }),
    );
    // He has a part there, so he is among those busy at that meeting.
    expect(
      (
        r.body.meetings as {
          weekStartDate: string;
          eventType: string;
          partPublisherIds: string[];
        }[]
      ).find((x) => x.weekStartDate === week && x.eventType === 'midweek')
        ?.partPublisherIds,
    ).toContain(brother);
  });

  it('the readiness count of an unopened meeting follows the template', async () => {
    const week = monday(7);
    const r = await h
      .as('admin')
      .get(`/readiness?weekStart=${week}&weekEnd=${monday(8)}`);
    expect(r.status).toBe(200);
    const mid = r.body[0].meetings.find(
      (m: { kind: string }) => m.kind === 'midweek',
    );
    // Парковка ×2, attendant, microphones ×3, AV.
    expect(mid.duties).toEqual({ created: false, assigned: 0, total: 7 });
  });
});
