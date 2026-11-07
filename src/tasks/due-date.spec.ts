jest.mock('expo-server-sdk', () => ({ Expo: class {} }));
import { addMonthsISO, resolveDueDate, TasksService } from './tasks.service';
import { clockStub } from '../common/testing/clock-stub';

/**
 * «In a week», «in three months» — counted from the congregation's own
 * today (7 November 2026). Before, the server's clock read back in UTC put a
 * period set just after midnight in Hamm a day early.
 */
describe('a due period becomes a date', () => {
  it('days and months count from the today it is given', () => {
    expect(resolveDueDate({ dueInDays: 7 }, '2026-11-07')).toBe('2026-11-14');
    expect(resolveDueDate({ dueInMonths: 3 }, '2026-11-07')).toBe('2027-02-07');
  });

  it('a plain date is kept, and nothing stays nothing', () => {
    expect(resolveDueDate({ dueDate: '2027-01-01', dueInDays: 3 }, '')).toBe(
      '2027-01-01',
    );
    expect(resolveDueDate({}, '2026-11-07')).toBeNull();
    expect(resolveDueDate({ dueDate: null }, '2026-11-07')).toBeNull();
  });

  it('a month keeps to the end of a short month', () => {
    expect(addMonthsISO('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsISO('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsISO('2026-08-31', 1)).toBe('2026-09-30');
    expect(addMonthsISO('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsISO('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonthsISO('2026-11-07', 60)).toBe('2031-11-07');
  });

  describe('the service asks the congregation clock', () => {
    afterEach(() => jest.useRealTimers());

    const serviceSaving = (saved: unknown[]) =>
      new TasksService(
        {
          create: (e: object) => ({ ...e }),
          save: async (e: object) => {
            saved.push(e);
            return { ...e, id: 't-1' };
          },
          findOne: async () => ({ id: 't-1', assignees: [] }),
        } as never,
        {} as never,
        { find: async () => [] } as never,
        { membersOfKind: async () => [] } as never,
        {
          announceAssignment: async () => undefined,
          rescheduleFor: async () => undefined,
        } as never,
        { record: async () => undefined, log: async () => undefined } as never,
        {} as never,
        clockStub('Europe/Berlin'),
      );

    it('just after midnight in Hamm it is already the new day', async () => {
      // 00:30 on 8 November in Berlin is still 7 November in UTC.
      jest.useFakeTimers({ now: new Date('2026-11-07T23:30:00Z') });
      const saved: { dueDate?: string | null }[] = [];
      await serviceSaving(saved)
        .createTask('cong-1', { title: 'Call', dueInDays: 7 }, null)
        .catch(() => undefined);
      expect(saved[0]?.dueDate).toBe('2026-11-15');
    });
  });
});
