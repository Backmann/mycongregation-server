import { Harness, startHarness } from './harness';

/**
 * A meeting moved for one week (4 November 2026): the table holds its own
 * rules, and the week rules' loader really reads it — a spec's hand-made
 * repository has no manager, so only a real database can show that.
 */
describe('meeting moves (real database)', () => {
  let h: Harness;
  let tenantId: string;
  let schoolId: string;
  let helperId: string;
  let publisherId: string;

  // Monday 5 April 2027; the midweek meeting is on the Wednesday (7th).
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
    await h.sql(`DELETE FROM meeting_moves WHERE congregation_id = $1`, [
      tenantId,
    ]);
    await h.sql(`DELETE FROM duties WHERE congregation_id = $1`, [tenantId]);
    await h.sql(
      `UPDATE pioneer_school_duties SET helper_id = NULL
        WHERE day_id IN (SELECT id FROM pioneer_school_days WHERE school_id = $1)`,
      [schoolId],
    );
  });

  const move = (week: string, kind: string, date: string, time = '18:30') =>
    h.sql(
      `INSERT INTO meeting_moves (congregation_id, week_start_date, event_type, date, time)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, week, kind, date, time],
    );

  describe('the table keeps its own rules', () => {
    it('one move per meeting per week', async () => {
      await move(WEEK, 'midweek', '2027-04-05');
      await expect(move(WEEK, 'midweek', '2027-04-06')).rejects.toThrow();
      await expect(move(WEEK, 'weekend', '2027-04-10')).resolves.toBeDefined();
    });
    it('the new day stays inside its own week', async () => {
      await expect(move(WEEK, 'midweek', '2027-04-12')).rejects.toThrow();
      await expect(move(WEEK, 'midweek', '2027-04-04')).rejects.toThrow();
    });
    it('the week is given by its Monday', async () => {
      await expect(
        move('2027-04-06', 'midweek', '2027-04-07'),
      ).rejects.toThrow();
    });
    it('a real hour and a known kind', async () => {
      await expect(
        move(WEEK, 'midweek', '2027-04-05', '25:00'),
      ).rejects.toThrow();
      await expect(move(WEEK, 'memorial', '2027-04-05')).rejects.toThrow();
    });
  });

  describe('the week rules read it', () => {
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

    it('a midweek meeting moved to the Monday makes him busy on the Monday, not the Wednesday', async () => {
      await h.sql(
        `INSERT INTO duties (congregation_id, week_start_date, event_type, duty_type, slot_index, publisher_id)
         VALUES ($1, $2, 'midweek', 'microphone', 0, $3)`,
        [tenantId, WEEK, publisherId],
      );
      const mon = await firstDutyOn('2027-04-05');
      const wed = await firstDutyOn('2027-04-07');
      await put(mon);
      await put(wed);
      // Without the move: the Wednesday.
      expect(await warningsOf(wed)).toContain('busyAtMeeting');
      expect(await warningsOf(mon)).not.toContain('busyAtMeeting');
      await move(WEEK, 'midweek', '2027-04-05');
      expect(await warningsOf(mon)).toContain('busyAtMeeting');
      expect(await warningsOf(wed)).not.toContain('busyAtMeeting');
    });
  });
});
