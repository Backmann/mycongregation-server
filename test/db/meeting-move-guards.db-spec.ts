import { Harness, startHarness } from './harness';

/**
 * The edges of a moved meeting (5 November 2026): an event «with changes»
 * may not lie on it, and a move a visit made void can be taken away without
 * anybody being told.
 */
describe('meeting moves: the edges (real database)', () => {
  let h: Harness;
  let tenantId: string;
  const WEEK = '2027-04-05'; // midweek Wed 7th, weekend Sun 11th

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
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    await h.sql(`DELETE FROM meeting_moves WHERE congregation_id = $1`, [
      tenantId,
    ]);
    await h.sql(`DELETE FROM special_events WHERE congregation_id = $1`, [
      tenantId,
    ]);
    await h.sql(
      `DELETE FROM notification_outbox WHERE congregation_id = $1 AND kind = 'meeting_move'`,
      [tenantId],
    );
  });

  const moveToThursday = async () => {
    const r = await h.as('admin').put(`/meeting-moves/${WEEK}/midweek`, {
      date: '2027-04-08',
      time: '18:30',
    });
    expect(r.status).toBe(200);
  };
  const changedEvent = (date: string) =>
    h.as('admin').post('/special-events', {
      title: 'Представитель филиала',
      type: 'other',
      date,
      meetingMode: 'changed',
      meetingTime: '18:00',
    });

  it('an event «with changes» on the moved meeting’s new or old day is refused; elsewhere it is not', async () => {
    await moveToThursday();
    const onNew = await changedEvent('2027-04-08');
    expect([onNew.status, onNew.body.code]).toEqual([
      409,
      'EVENT_MEETING_MOVED',
    ]);
    const onOld = await changedEvent('2027-04-07');
    expect([onOld.status, onOld.body.code]).toEqual([
      409,
      'EVENT_MEETING_MOVED',
    ]);
    const elsewhere = await changedEvent('2027-04-09');
    expect(elsewhere.status).toBe(201);
  });

  it('an event that leaves the meeting as it is may lie on it', async () => {
    await moveToThursday();
    const r = await h.as('admin').post('/special-events', {
      title: 'Уборка территории',
      type: 'other',
      date: '2027-04-08',
    });
    expect(r.status).toBe(201);
  });

  it('a move a visit made void is taken away quietly', async () => {
    await moveToThursday();
    await h.sql(
      `DELETE FROM notification_outbox WHERE congregation_id = $1 AND kind = 'meeting_move'`,
      [tenantId],
    );
    await h.sql(
      `INSERT INTO special_events (congregation_id, title, type, date, end_date, co_midweek_dow)
       VALUES ($1, 'Визит', 'circuit_overseer_visit', $2, '2027-04-11', 2)`,
      [tenantId, WEEK],
    );
    const back = await h.as('admin').delete(`/meeting-moves/${WEEK}/midweek`);
    expect(back.status).toBe(200);
    expect(
      await h.sql(`SELECT 1 FROM meeting_moves WHERE congregation_id = $1`, [
        tenantId,
      ]),
    ).toEqual([]);
    expect(
      await h.sql(
        `SELECT 1 FROM notification_outbox WHERE congregation_id = $1 AND kind = 'meeting_move'`,
        [tenantId],
      ),
    ).toEqual([]);
  });
});
