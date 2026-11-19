import { Harness, startHarness } from './harness';

/**
 * «Занят на встрече» on the pioneer school's schedule is about the DAY of
 * the meeting, not its week (4 November 2026). A duty at the Sunday meeting
 * used to flag a helper on every school day of that week.
 */
describe('pioneer school: busy at the meeting means that day (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let schoolId: string;
  let helperId: string;
  let publisherId: string;

  // Monday 5 April 2027 to Saturday 10 April; the midweek meeting is on the
  // Wednesday (7th), the weekend meeting on the Sunday (11th).
  const WEEK = '2027-04-05';

  beforeAll(async () => {
    h = await startHarness();
    [{ id: tenantId }] = await h.sql<{ id: string }>(
      `SELECT id FROM congregations LIMIT 1`,
    );
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
    publisherId = await h.addPublisher({
      firstName: 'Тимо',
      lastName: 'Ланг',
      baptismDate: '2012-01-01',
    });
    const helper = await h.as('admin').post('/pioneer-school/helpers', {
      firstName: 'Тимо',
      lastName: 'Ланг',
      publisherId,
    });
    expect([200, 201]).toContain(helper.status);
    helperId = helper.body.id;
    const school = await h.as('admin').post('/pioneer-school', {
      title: 'Школа',
      startDate: '2027-04-05',
      endDate: '2027-04-10',
    });
    expect([200, 201]).toContain(school.status);
    schoolId = school.body.id;
    expect(
      (await h.as('admin').get(`/pioneer-school/${schoolId}`)).status,
    ).toBe(200);
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    await h.sql(`DELETE FROM duties WHERE congregation_id = $1`, [tenantId]);
    await h.sql(
      `UPDATE pioneer_school_duties SET helper_id = NULL
        WHERE day_id IN (SELECT id FROM pioneer_school_days WHERE school_id = $1)`,
      [schoolId],
    );
  });

  const firstDutyOn = async (date: string) =>
    (
      await h.sql<{ id: string }>(
        `SELECT d.id FROM pioneer_school_duties d
           JOIN pioneer_school_days y ON y.id = d.day_id
          WHERE y.school_id = $1 AND y.date = $2
          ORDER BY d.duty_type, d.slot_index LIMIT 1`,
        [schoolId, date],
      )
    )[0].id;

  const meetingDuty = (eventType: 'midweek' | 'weekend') =>
    h.sql(
      `INSERT INTO duties (congregation_id, week_start_date, event_type, duty_type, slot_index, publisher_id)
       VALUES ($1, $2, $3, 'microphone', 0, $4)`,
      [tenantId, WEEK, eventType, publisherId],
    );

  const warningsOf = async (dutyId: string): Promise<string[]> => {
    const r = await h.as('admin').get(`/pioneer-school/${schoolId}`);
    expect(r.status).toBe(200);
    for (const day of r.body.days) {
      for (const d of day.duties) if (d.id === dutyId) return d.warnings;
    }
    throw new Error('duty not found');
  };

  const put = async (dutyId: string) => {
    const r = await h
      .as('admin')
      .patch(`/pioneer-school/${schoolId}/duties/${dutyId}`, { helperId });
    expect(r.status).toBe(200);
  };

  it('a Sunday microphone does not make him busy on the school’s Wednesday', async () => {
    const wed = await firstDutyOn('2027-04-07');
    await meetingDuty('weekend');
    await put(wed);
    expect(await warningsOf(wed)).not.toContain('busyAtMeeting');
  });

  it('a midweek microphone makes him busy on that Wednesday, not on the Monday', async () => {
    const wed = await firstDutyOn('2027-04-07');
    const mon = await firstDutyOn('2027-04-05');
    await meetingDuty('midweek');
    await put(wed);
    await put(mon);
    expect(await warningsOf(wed)).toContain('busyAtMeeting');
    expect(await warningsOf(mon)).not.toContain('busyAtMeeting');
  });

  // 19 November 2026: Home showed the school's absence («В отъезде») and
  // nothing of the duty. /me/assignments now carries his school days. The
  // school is placed from the real today: the endpoint reads from today on.
  it('/me/assignments carries his school days, one item a day, and only his', async () => {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const start = new Date(Date.now() + 28 * 86400000);
    const day1 = iso(start);
    const day3 = iso(new Date(start.getTime() + 2 * 86400000));
    const created = await h.as('admin').post('/pioneer-school', {
      title: 'Школа скоро',
      startDate: day1,
      endDate: day3,
    });
    expect([200, 201]).toContain(created.status);
    const soonId: string = created.body.id;
    const dutyOn = async (date: string) =>
      (
        await h.sql<{ id: string }>(
          `SELECT d.id FROM pioneer_school_duties d
             JOIN pioneer_school_days y ON y.id = d.day_id
            WHERE y.school_id = $1 AND y.date = $2
            ORDER BY d.duty_type, d.slot_index LIMIT 1`,
          [soonId, date],
        )
      )[0].id;
    for (const date of [day1, day3]) {
      const r = await h
        .as('admin')
        .patch(`/pioneer-school/${soonId}/duties/${await dutyOn(date)}`, {
          helperId,
        });
      expect(r.status).toBe(200);
    }
    await h.addUser({ login: 'langschool', role: 'publisher', publisherId });
    const items = (
      (await h.as('langschool').get('/me/assignments')).body.items as {
        kind: string;
        date?: string;
        agendaId?: string;
        label?: string;
        schoolDuties?: { type: string }[];
      }[]
    ).filter((i) => i.kind === 'pioneer_school' && i.label === 'Школа скоро');
    expect(items.map((i) => i.date)).toEqual([day1, day3]);
    expect(items[0].agendaId).toBe(`pioneer_school:${soonId}:${day1}`);
    expect(items[0].schoolDuties?.length).toBe(1);
    const other = (
      (await h.as('admin').get('/me/assignments')).body.items as {
        kind: string;
      }[]
    ).filter((i) => i.kind === 'pioneer_school');
    expect(other).toEqual([]);
  });
});
