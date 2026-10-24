import { Harness, startHarness } from './harness';

/**
 * The pioneer school's absences after the school was planned (sync audit of
 * 23 October 2026, decided with Lionel on 24 October): a helper removed from
 * the list, our weekend meeting, a circuit overseer's visit entered later, a
 * school removed, an absence edited by hand.
 */
describe('pioneer school absences follow the meetings (real database)', () => {
  let h: Harness;
  let schoolId: string;
  let helperId: string;
  let publisherId: string;
  // Monday 5 to Sunday 11 April 2027; our midweek meeting is on Wednesday.
  const WED = '2027-04-07';
  const TUE = '2027-04-06';
  const SUN = '2027-04-11';

  beforeAll(async () => {
    h = await startHarness();
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
      endDate: '2027-04-11',
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

  const dutyOn = async (date: string, n = 0): Promise<string> =>
    (
      await h.sql<{ id: string }>(
        `SELECT d.id FROM pioneer_school_duties d
           JOIN pioneer_school_days y ON y.id = d.day_id
          WHERE y.school_id = $1 AND y.date = $2
          ORDER BY d.duty_type, d.slot_index`,
        [schoolId, date],
      )
    )[n].id;
  const assign = async (dutyId: string, who: string | null) => {
    const r = await h
      .as('admin')
      .patch(`/pioneer-school/${schoolId}/duties/${dutyId}`, {
        helperId: who,
      });
    expect(r.status).toBe(200);
  };
  const awayOn = async (): Promise<string[]> =>
    (
      await h.sql<{ d: string }>(
        `SELECT to_char(start_date, 'YYYY-MM-DD') AS d FROM absences
          WHERE publisher_id = $1 AND pioneer_school_duty_id IS NOT NULL
            AND deleted_at IS NULL
          ORDER BY start_date`,
        [publisherId],
      )
    ).map((r) => r.d);

  it('a duty on our weekend meeting makes him away too', async () => {
    await assign(await dutyOn(SUN), helperId);
    expect(await awayOn()).toEqual([SUN]);
    await assign(await dutyOn(SUN), null);
    expect(await awayOn()).toEqual([]);
  });

  it('removing a helper takes his places ahead off, and «Отменить» gives them back', async () => {
    const wed = await dutyOn(WED);
    await assign(wed, helperId);
    expect(await awayOn()).toEqual([WED]);

    const impact = await h
      .as('admin')
      .get(`/pioneer-school/helpers/${helperId}/removal-impact`);
    expect(impact.body).toEqual({ duties: 1, dates: [WED] });

    const removed = await h
      .as('admin')
      .delete(`/pioneer-school/helpers/${helperId}`);
    expect(removed.status).toBe(200);
    expect(removed.body.cleared).toEqual([{ dutyId: wed, date: WED }]);
    const [{ helper }] = await h.sql<{ helper: string | null }>(
      `SELECT helper_id AS helper FROM pioneer_school_duties WHERE id = $1`,
      [wed],
    );
    expect(helper).toBeNull();
    expect(await awayOn()).toEqual([]);

    const back = await h
      .as('admin')
      .post(`/pioneer-school/helpers/${helperId}/restore`, { dutyIds: [wed] });
    expect(back.status).toBe(204);
    expect(await awayOn()).toEqual([WED]);
  });

  it('a school absence cannot be edited by hand', async () => {
    const [a] = await h.sql<{ id: string }>(
      `SELECT id FROM absences WHERE publisher_id = $1 AND pioneer_school_duty_id IS NOT NULL AND deleted_at IS NULL`,
      [publisherId],
    );
    const r = await h
      .as('admin')
      .patch(`/absences/${a.id}`, { endDate: '2027-04-08' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ABSENCE_FROM_SCHOOL');
  });

  it('a circuit overseer visit entered later moves the absence with the meeting, without opening the school', async () => {
    // He holds Tuesday as well as Wednesday.
    await assign(await dutyOn(TUE), helperId);
    expect(await awayOn()).toEqual([WED]);
    const ev = await h.as('admin').post('/special-events', {
      title: 'Посещение районного',
      type: 'circuit_overseer_visit',
      date: TUE,
      endDate: SUN,
      coMidweekDow: 2,
    });
    expect([200, 201]).toContain(ev.status);
    // The midweek meeting is on Tuesday now.
    expect(await awayOn()).toEqual([TUE]);
    await h.as('admin').delete(`/special-events/${ev.body.id}`);
    expect(await awayOn()).toEqual([WED]);
  });

  it('a school removed takes its absences with it', async () => {
    expect(await awayOn()).not.toEqual([]);
    const r = await h.as('admin').delete(`/pioneer-school/${schoolId}`);
    expect(r.status).toBeLessThan(300);
    expect(await awayOn()).toEqual([]);
  });
});
