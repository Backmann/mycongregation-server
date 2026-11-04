import { Harness, startHarness } from './harness';
import { AttendanceReminderService } from '../../src/meeting-attendance/attendance-reminder.service';
import { CartWeeksService } from '../../src/cart-weeks/cart-weeks.service';

/**
 * An absence with no end date is ONE day (absence.entity.ts), not "away from
 * then on" (4 November 2026). Two places read it as open-ended: the 20:00
 * attendance reminder skipped the counter for good after a single day off,
 * and the stand counted him away on every later day of the week.
 */
describe('a one-day absence is one day (real database)', () => {
  let h: Harness;
  let tenant = '';
  const pid: Record<string, string> = {};
  const uid: Record<string, string> = {};

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (s: string, n: number) => {
    const d = new Date(`${s}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return iso(d);
  };
  const today = iso(new Date());
  const monday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return iso(d);
  })();

  const away = async (who: string, start: string, end: string | null) => {
    await h.sql(
      `INSERT INTO absences (congregation_id, publisher_id, start_date, end_date)
       VALUES ($1, $2, $3, $4)`,
      [tenant, pid[who], start, end],
    );
  };

  beforeAll(async () => {
    h = await startHarness();
    [{ congregation_id: tenant }] = await h.sql<{ congregation_id: string }>(
      `SELECT congregation_id FROM users LIMIT 1`,
    );
    for (const [login, type] of [
      ['counter', 'attendance_recorder'],
      ['helper', 'attendance_recorder_assistant'],
    ] as const) {
      pid[login] = await h.addPublisher({
        firstName: login,
        lastName: 'Тест',
        baptismDate: '2000-01-01',
        appointment: 'ministerial_servant',
      });
      uid[login] = await h.addUser({
        login,
        role: 'ministerial_servant',
        publisherId: pid[login],
      });
      const r = await h
        .as('admin')
        .post('/responsibilities', { type, userId: uid[login] });
      expect(r.status).toBe(201);
    }
  });
  afterAll(async () => {
    await h?.close();
  });
  afterEach(async () => {
    await h.sql(`DELETE FROM absences WHERE congregation_id = $1`, [tenant]);
  });

  describe('the 20:00 attendance reminder', () => {
    const told = () =>
      h.app.get(AttendanceReminderService).whoIsTold(tenant, today);

    it('a day off yesterday does not keep the counter away today', async () => {
      await away('counter', addDays(today, -1), null);
      expect(await told()).toBe(uid.counter);
    });

    it('a day off today hands it to the one who stands in', async () => {
      await away('counter', today, null);
      expect(await told()).toBe(uid.helper);
    });

    it('a span that runs through today still counts', async () => {
      await away('counter', addDays(today, -3), addDays(today, 3));
      expect(await told()).toBe(uid.helper);
    });
  });

  describe('the stand', () => {
    const awayOn = async (date: string) => {
      const svc = h.app.get(CartWeeksService) as unknown as {
        absencesFor(
          c: string,
          ids: string[],
          week: string,
        ): Promise<(p: string, d: string) => boolean>;
      };
      const isAway = await svc.absencesFor(tenant, [pid.counter], monday);
      return isAway(pid.counter, date);
    };

    it('a day off on Monday is that Monday only', async () => {
      await away('counter', monday, null);
      expect(await awayOn(monday)).toBe(true);
      expect(await awayOn(addDays(monday, 1))).toBe(false);
      expect(await awayOn(addDays(monday, 6))).toBe(false);
    });

    it('a day off last week does not reach into this one', async () => {
      await away('counter', addDays(monday, -3), null);
      expect(await awayOn(monday)).toBe(false);
    });

    it('a span still covers its days', async () => {
      await away('counter', addDays(monday, 1), addDays(monday, 3));
      expect(await awayOn(addDays(monday, 2))).toBe(true);
      expect(await awayOn(addDays(monday, 4))).toBe(false);
    });
  });
});
