// The push SDK ships as ESM, which jest does not load; nothing here pushes.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { CongregationSummaryService } from './congregation-summary.service';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * The rule the summary lives by: no line says more than the screen behind
 * its door would. Checked here for each kind of person.
 */
const TENANT = 'c1';
const user = (role: UserRole, id = 'u1'): AuthenticatedUser =>
  ({ id, role, congregationId: TENANT }) as unknown as AuthenticatedUser;

function build(opts: {
  responsibilities?: number;
  privileged?: boolean;
  readsAll?: boolean;
}) {
  const repo = (overrides: Record<string, unknown> = {}) => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    ...overrides,
  });
  const tasks = repo({
    find: jest
      .fn()
      .mockResolvedValue([
        { dueDate: '2026-09-01' },
        { dueDate: '2026-12-01' },
        { dueDate: null },
      ]),
  });
  const publishers = repo({ count: jest.fn().mockResolvedValue(88) });
  const readiness = { forRange: jest.fn().mockResolvedValue([]) };
  const service = new CongregationSummaryService(
    { todayFor: jest.fn().mockResolvedValue('2026-09-27') } as never,
    readiness as never,
    {
      findAll: jest.fn().mockResolvedValue([]),
      readsAll: jest.fn().mockResolvedValue(!!opts.readsAll),
    } as never,
    {
      getEffective: jest.fn().mockResolvedValue({
        midweekDow: 3,
        midweekTime: '19:00',
        weekendDow: 7,
        weekendTime: '13:00',
      }),
    } as never,
    {
      resolvePrivateAccess: jest.fn().mockResolvedValue(!!opts.privileged),
    } as never,
    repo({
      count: jest.fn().mockResolvedValue(opts.responsibilities ?? 0),
    }) as never,
    publishers as never,
    repo() as never,
    tasks as never,
    repo() as never,
    repo() as never,
  );
  return { service, tasks, publishers, readiness };
}

describe('CongregationSummaryService — who is told what', () => {
  it('a publisher: no programme count, no tasks, no roster count', async () => {
    const { service, tasks, publishers } = build({});
    const s = await service.forUser(TENANT, user(UserRole.PUBLISHER));
    expect(s.programme).toBeUndefined();
    expect(s.tasks).toBeUndefined();
    expect(s.publishers).toBeUndefined();
    expect(s.absences.awayNow).toBeNull();
    expect(tasks.find).not.toHaveBeenCalled();
    expect(publishers.count).not.toHaveBeenCalled();
    // What any member reads anyway.
    expect(s.meetingPlace).toEqual({
      midweekDow: 3,
      midweekTime: '19:00',
      weekendDow: 7,
      weekendTime: '13:00',
    });
  });

  it('an elder without the programme responsibility: tasks, but not the readiness count', async () => {
    const { service } = build({ privileged: true, readsAll: true });
    const s = await service.forUser(TENANT, user(UserRole.ELDER));
    expect(s.programme).toBeUndefined();
    expect(s.tasks).toEqual({ open: 3, overdue: 1 });
    expect(s.publishers).toEqual({ count: 88 });
    expect(s.absences.awayNow).toBe(0);
  });

  it('whoever assembles the programme gets its count', async () => {
    const { service } = build({ responsibilities: 1 });
    const s = await service.forUser(TENANT, user(UserRole.MINISTERIAL_SERVANT));
    expect(s.programme).toEqual({
      windowWeeks: 4,
      notReady: 0,
      loadedUntil: null,
    });
    expect(s.tasks).toBeUndefined();
  });

  it('the programme line looks four weeks ahead: this week and the next three', async () => {
    const { service, readiness } = build({ responsibilities: 1 });
    await service.forUser(TENANT, user(UserRole.MINISTERIAL_SERVANT));
    // Today is Sunday 27 September: its week began on the 21st, and the
    // range ends before Monday 19 October.
    expect(readiness.forRange).toHaveBeenCalledWith(
      TENANT,
      '2026-09-21',
      '2026-10-19',
    );
  });

  it('an admin gets every line', async () => {
    const { service } = build({ privileged: true, readsAll: true });
    const s = await service.forUser(TENANT, user(UserRole.ADMIN));
    expect(s.programme).toBeDefined();
    expect(s.tasks).toBeDefined();
    expect(s.publishers).toBeDefined();
    // No meetings this week in the readiness weeks (a convention, here an
    // empty stand): no cleaning after them to miss.
    expect(s.cleaning.thisWeek.meetingsHeld).toBe(false);
  });
});
