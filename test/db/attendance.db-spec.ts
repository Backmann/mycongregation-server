import { Harness, startHarness } from './harness';

/**
 * Meeting attendance against a real database (31 October 2026): who may
 * enter it, the checks Postgres itself keeps, two people at once, a figure
 * taken away or moved, and the journal saying which meeting.
 */
describe('meeting attendance (real database)', () => {
  let h: Harness;
  let tenantId: string;
  const users: Record<string, string> = {};

  // The last Wednesday and the Wednesday before it — meeting days below.
  const wednesdays = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() - 1);
    const last = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() - 7);
    return { last, before: d.toISOString().slice(0, 10) };
  })();
  const tuesdayBefore = (() => {
    const d = new Date(`${wednesdays.last}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const nextWednesday = (() => {
    const d = new Date(`${wednesdays.last}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 14);
    return d.toISOString().slice(0, 10);
  })();

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
      weekendTime: '13:00',
      address: 'Musterstraße 1, 59065 Hamm',
      confirmPast: true,
    });
    expect([200, 201]).toContain(settings.status);
    for (const [login, role, type] of [
      ['duties', 'ministerial_servant', 'duties_coordinator'],
      ['counter', 'ministerial_servant', 'attendance_recorder'],
      ['elder1', 'elder', null],
      ['pub', 'publisher', null],
    ] as const) {
      const card = await h.addPublisher({
        firstName: login,
        lastName: 'Тест',
        baptismDate: '2000-01-01',
        // The card's appointment and the account's role go together.
        ...(role === 'elder'
          ? { appointment: 'elder' }
          : role === 'ministerial_servant'
            ? { appointment: 'ministerial_servant' }
            : {}),
      });
      users[login] = await h.addUser({ login, role, publisherId: card });
      if (type) {
        const r = await h
          .as('admin')
          .post('/responsibilities', { type, userId: users[login] });
        expect(r.status).toBe(201);
      }
    }
  });
  afterAll(async () => {
    await h?.close();
  });

  it('the duties coordinator enters it; an elder only reads; a publisher neither', async () => {
    const body = {
      date: wednesdays.before,
      eventType: 'midweek',
      count: 96,
      onlineCount: 12,
    };
    expect(
      (await h.as('elder1').post('/meeting-attendance', body)).status,
    ).toBe(403);
    expect((await h.as('pub').post('/meeting-attendance', body)).status).toBe(
      403,
    );
    const ok = await h.as('duties').post('/meeting-attendance', body);
    expect(ok.status).toBe(201);
    const year = await h.as('elder1').get('/meeting-attendance/service-year');
    expect(year.status).toBe(200);
    expect(year.body.yearly).toBeDefined();
    expect(
      (await h.as('pub').get('/meeting-attendance/service-year')).status,
    ).toBe(403);
  });

  it('Postgres keeps those by video inside the figure', async () => {
    await expect(
      h.sql(
        `INSERT INTO meeting_attendance (congregation_id, date, event_type, count, online_count, not_held)
         VALUES ($1, '2020-01-01', 'midweek', 10, 11, false)`,
        [tenantId],
      ),
    ).rejects.toThrow(/ck_meeting_attendance_online/);
    await expect(
      h.sql(
        `INSERT INTO meeting_attendance (congregation_id, date, event_type, count, not_held, not_held_reason)
         VALUES ($1, '2020-01-02', 'midweek', 10, false, 'weather')`,
        [tenantId],
      ),
    ).rejects.toThrow(/ck_meeting_attendance_reason/);
  });

  it('refuses a day still ahead and a day with no meeting', async () => {
    const ahead = await h.as('counter').post('/meeting-attendance', {
      date: nextWednesday,
      eventType: 'midweek',
      count: 90,
    });
    expect(ahead.body.code).toBe('ATTENDANCE_FUTURE');
    const noMeeting = await h.as('counter').post('/meeting-attendance', {
      date: tuesdayBefore,
      eventType: 'midweek',
      count: 90,
    });
    expect(noMeeting.body.code).toBe('ATTENDANCE_NOT_A_MEETING');
  });

  it('the second of two at once is told who was first', async () => {
    const first = await h.as('counter').post('/meeting-attendance', {
      date: wednesdays.last,
      eventType: 'midweek',
      count: 98,
      expectNew: true,
    });
    expect(first.status).toBe(201);
    const second = await h.as('duties').post('/meeting-attendance', {
      date: wednesdays.last,
      eventType: 'midweek',
      count: 99,
      expectNew: true,
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ATTENDANCE_ALREADY_RECORDED');
    expect(second.body.current.count).toBe(98);
    expect(second.body.current.recordedByName).toBe('Тест counter');
  });

  it('a figure on a day that lost its meeting is moved to the right one, and the journal says which meeting', async () => {
    // A figure standing on the Tuesday, as after a visit moved back.
    await h.sql(`DELETE FROM meeting_attendance WHERE date = $1`, [
      wednesdays.before,
    ]);
    await h.sql(
      `INSERT INTO meeting_attendance (congregation_id, date, event_type, count, not_held)
       VALUES ($1, $2, 'midweek', 91, false)`,
      [tenantId, tuesdayBefore],
    );
    const before = await h
      .as('counter')
      .get('/meeting-attendance/service-year');
    const all = before.body.months.flatMap(
      (m: { midweek: { date: string; offSchedule?: boolean }[] }) => m.midweek,
    );
    expect(
      all.find((r: { date: string }) => r.date === tuesdayBefore).offSchedule,
    ).toBe(true);

    // Not onto a meeting that has its own figure.
    const onto = await h.as('counter').post('/meeting-attendance/move', {
      date: tuesdayBefore,
      eventType: 'midweek',
      toDate: wednesdays.last,
    });
    expect(onto.body.code).toBe('ATTENDANCE_MOVE_TARGET');

    const moved = await h.as('counter').post('/meeting-attendance/move', {
      date: tuesdayBefore,
      eventType: 'midweek',
      toDate: wednesdays.before,
    });
    expect(moved.status).toBe(201);
    const [row] = await h.sql<{ date: string }>(
      `SELECT to_char(date, 'YYYY-MM-DD') AS date FROM meeting_attendance WHERE count = 91`,
    );
    expect(row.date).toBe(wednesdays.before);

    const journal = await h
      .as('admin')
      .get('/journal?entityType=meeting_attendance&limit=20');
    expect(journal.status).toBe(200);
    const entry = journal.body.items.find((e: { changedFields: string[] }) =>
      e.changedFields.includes('date'),
    );
    expect(entry.context).toMatchObject({
      date: wednesdays.before,
      eventType: 'midweek',
    });
  });

  it('takes a figure away', async () => {
    const del = await h
      .as('counter')
      .delete(
        `/meeting-attendance?date=${wednesdays.before}&eventType=midweek`,
      );
    expect(del.status).toBe(200);
    const left = await h.sql(
      `SELECT 1 FROM meeting_attendance WHERE date = $1`,
      [wednesdays.before],
    );
    expect(left).toHaveLength(0);
  });
});
