jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { TaskRemindersService } from './task-reminders.service';
import { TaskAddresseesService } from './task-addressees.service';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * Two silences the reminders had, and neither looked like a fault.
 *
 * A task nobody was given reached nobody at all: the list of addressees came
 * out empty and the pass moved on. And every congregation's day was measured
 * in Berlin — invisibly right while there is one congregation, and quietly
 * wrong on the evening the second one is a few hours away.
 */
describe('a task nobody was given', () => {
  const build = (over: {
    assigned?: unknown[];
    coordinators?: unknown[];
    elders?: unknown[];
  }) => {
    const byResponsibility = jest.fn(async (_c: string, types: unknown[]) => {
      const wanted = types as ResponsibilityType[];
      return wanted.includes(ResponsibilityType.BODY_COORDINATOR)
        ? (over.coordinators ?? [])
        : [];
    });
    const service = Object.create(
      TaskAddresseesService.prototype,
    ) as TaskAddresseesService;
    Object.assign(service, {
      byResponsibility,
      publishers: { find: jest.fn(async () => over.elders ?? []) },
      membersOf: jest.fn(async () => over.assigned ?? []),
    });
    return { service, byResponsibility };
  };

  const task = { congregationId: 'c1', assigneeKind: 'people' } as never;

  it('leaves an assigned task to the people it was given to', async () => {
    const { service, byResponsibility } = build({
      assigned: [{ id: 'p1' }],
      coordinators: [{ id: 'coord' }],
    });

    await expect(service.remindees(task)).resolves.toEqual([{ id: 'p1' }]);
    // The coordinator's name must not appear on somebody else's work.
    expect(byResponsibility).not.toHaveBeenCalled();
  });

  it('tells the coordinator and his assistant when nobody was given it', async () => {
    const { service, byResponsibility } = build({
      assigned: [],
      coordinators: [{ id: 'coord' }, { id: 'assistant' }],
    });

    const out = await service.remindees(task);

    expect(out).toEqual([{ id: 'coord' }, { id: 'assistant' }]);
    const [, types] = byResponsibility.mock.calls[0] as [string, unknown[]];
    expect(types).toEqual([
      ResponsibilityType.BODY_COORDINATOR,
      ResponsibilityType.BODY_COORDINATOR_ASSISTANT,
    ]);
  });

  it('falls through to the whole body when even that chair is empty', async () => {
    // One notice too many beats a task that quietly reminds nobody.
    const { service } = build({
      assigned: [],
      coordinators: [],
      elders: [{ id: 'e1' }, { id: 'e2' }],
    });

    await expect(service.remindees(task)).resolves.toEqual([
      { id: 'e1' },
      { id: 'e2' },
    ]);
  });
});

describe('TaskRemindersService.runDue — every congregation keeps its own day', () => {
  const build = (tasks: unknown[], zones: Record<string, string>) => {
    const sent: { tenantId: string; data: unknown }[] = [];
    const service = Object.create(
      TaskRemindersService.prototype,
    ) as TaskRemindersService;
    Object.assign(service, {
      tasks: { find: jest.fn(async () => tasks) },
      meetings: { find: jest.fn(async () => []) },
      congregations: {
        findOne: jest.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          timezone: zones[where.id],
          uiLanguage: 'ru',
        })),
      },
      addressees: { remindees: async () => [{ id: 'p1', userId: 'u1' }] },
      notifications: {
        notify: jest.fn(async (n: { tenantId: string; data: unknown }) => {
          sent.push(n);
        }),
      },
      logger: { log: jest.fn(), warn: jest.fn() },
    });
    return { service, sent };
  };

  const task = (id: string, congregationId: string, dueDate: string) => ({
    id,
    congregationId,
    dueDate,
    dueTime: null,
    status: 'open',
    area: 'other',
    assignees: [],
  });

  it('warns the day before in the congregation\u2019s own zone, not the server\u2019s', async () => {
    // 22:30 UTC on 21 August. In Berlin (+2) it is already the 22nd, so the
    // 23rd is «tomorrow». In Anchorage (−8) it is still the 21st, and the 23rd
    // is the day after tomorrow — no reminder yet.
    const now = new Date('2026-08-21T22:30:00Z');
    const { service, sent } = build(
      [
        task('berlin', 'c-de', '2026-08-23'),
        task('alaska', 'c-us', '2026-08-23'),
      ],
      { 'c-de': 'Europe/Berlin', 'c-us': 'America/Anchorage' },
    );

    await service.runDue(now);

    expect(sent.map((n) => n.tenantId)).toEqual(['c-de']);
  });

  it('calls a task late only where the day has actually turned', async () => {
    // Same instant; the 22nd is yesterday in Berlin and today in Anchorage.
    const now = new Date('2026-08-23T04:00:00Z');
    const { service, sent } = build(
      [
        task('berlin', 'c-de', '2026-08-22'),
        task('alaska', 'c-us', '2026-08-22'),
      ],
      { 'c-de': 'Europe/Berlin', 'c-us': 'America/Anchorage' },
    );

    await service.runDue(now);

    expect(sent).toHaveLength(1);
    expect(sent[0].tenantId).toBe('c-de');
    expect((sent[0].data as { type: string }).type).toBe('task_overdue');
  });
});
