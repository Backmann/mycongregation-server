import { Harness, startHarness } from './harness';
import { todayIn } from '../../src/common/congregation-clock';
import { addMonthsISO } from '../../src/tasks/tasks.service';
import { addDaysISO } from '../../src/common/week-rules';

/**
 * «In a week», «in a month» sent instead of a date become a date counted from
 * the congregation's own today (7 November 2026) — through the real route,
 * validation and database, not only the function.
 */
describe('a task due in a period (real database)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it('days and months become dates from today in the congregation', async () => {
    const today = todayIn(new Date(), 'Europe/Berlin');
    const week = await h
      .as('admin')
      .post('/tasks', { title: 'Через неделю', dueInDays: 7 });
    expect(week.status).toBe(201);
    expect(week.body.dueDate).toBe(addDaysISO(today, 7));

    const month = await h
      .as('admin')
      .post('/tasks', { title: 'Через месяц', dueInMonths: 1 });
    expect(month.status).toBe(201);
    expect(month.body.dueDate).toBe(addMonthsISO(today, 1));

    const moved = await h
      .as('admin')
      .patch(`/tasks/${week.body.id}`, { dueInMonths: 3 });
    expect(moved.status).toBe(200);
    expect(moved.body.dueDate).toBe(addMonthsISO(today, 3));
  });
});
