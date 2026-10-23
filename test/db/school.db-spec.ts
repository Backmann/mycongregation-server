import { Harness, startHarness } from './harness';

/**
 * The pioneer service school and the absences it writes (23 October 2026).
 *
 * Found by the sync audit: deleting the absence the school had written hid it
 * from the school, whose next sync tried to write a second one, hit the index
 * that allows one per duty, and failed on every assignment after.
 */
describe('pioneer school absences (real database)', () => {
  let h: Harness;
  let schoolId: string;
  let helperId: string;
  let publisherId: string;

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
    // A week in the future: Monday to Saturday, Wednesday is a meeting night.
    const school = await h.as('admin').post('/pioneer-school', {
      title: 'Школа',
      startDate: '2027-03-01',
      endDate: '2027-03-06',
    });
    expect([200, 201]).toContain(school.status);
    schoolId = school.body.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  async function dutiesOnWednesday(): Promise<{ id: string }[]> {
    return h.sql(
      `SELECT d.id FROM pioneer_school_duties d
         JOIN pioneer_school_days y ON y.id = d.day_id
        WHERE y.school_id = $1 AND y.date = '2027-03-03'
        ORDER BY d.duty_type, d.slot_index`,
      [schoolId],
    );
  }

  it('an absence the school wrote cannot be deleted by hand, and the school keeps working', async () => {
    // Open it once so its days and duties exist.
    expect(
      (await h.as('admin').get(`/pioneer-school/${schoolId}`)).status,
    ).toBe(200);
    const duties = await dutiesOnWednesday();
    expect(duties.length).toBeGreaterThan(1);

    const first = await h
      .as('admin')
      .patch(`/pioneer-school/${schoolId}/duties/${duties[0].id}`, {
        helperId,
      });
    expect(first.status).toBe(200);
    const [absence] = await h.sql<{ id: string }>(
      `SELECT id FROM absences WHERE pioneer_school_duty_id = $1 AND deleted_at IS NULL`,
      [duties[0].id],
    );
    expect(absence).toBeDefined();

    const del = await h.as('admin').delete(`/absences/${absence.id}`);
    expect(del.status).toBe(400);
    expect(del.body.code).toBe('ABSENCE_FROM_SCHOOL');

    // The next assignment in the school still goes through.
    const second = await h
      .as('admin')
      .patch(`/pioneer-school/${schoolId}/duties/${duties[1].id}`, {
        helperId: null,
      });
    expect(second.status).toBe(200);
  });

  it('a school absence deleted before this fix is brought back, not written twice', async () => {
    const duties = await dutiesOnWednesday();
    // The state an older app could leave: the school's absence soft-deleted.
    await h.sql(
      `UPDATE absences SET deleted_at = now() WHERE pioneer_school_duty_id = $1`,
      [duties[0].id],
    );
    const again = await h
      .as('admin')
      .patch(`/pioneer-school/${schoolId}/duties/${duties[1].id}`, {
        helperId: null,
      });
    expect(again.status).toBe(200);
    const rows = await h.sql<{ deleted: boolean }>(
      `SELECT deleted_at IS NOT NULL AS deleted FROM absences WHERE pioneer_school_duty_id = $1`,
      [duties[0].id],
    );
    expect(rows).toEqual([{ deleted: false }]);
    expect(publisherId).toBeTruthy();
  });
});
