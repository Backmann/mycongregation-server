import { FieldServiceAutomationService } from './field-service-automation.service';
import type { FieldServiceSettings } from '../entities/field-service-settings.entity';

jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

/**
 * The month prepared, reminded about and published without being asked
 * (October 2026, stage 5). Each step once per month, on the right day.
 */

const CONG = 'cong-1';
const NOW = new Date('2026-10-02T03:40:00Z');

type Meeting = { id: string; publishedAt: Date | null };

function settings(p: Partial<FieldServiceSettings> = {}): FieldServiceSettings {
  return {
    congregationId: CONG,
    skipAssemblies: true,
    coVisitFromSchedule: true,
    autoPrepare: true,
    prepareLead: '1m',
    autoPickConductors: true,
    unpublishedPolicy: 'publish_7d',
    updatedAt: NOW,
    ...p,
  };
}

function build(
  opts: { months?: Record<string, Meeting[]>; tasks?: any[] } = {},
) {
  const months: Record<string, Meeting[]> = opts.months ?? {};
  const runs = new Map<string, any>();
  const runsRepo = {
    findOne: jest.fn(
      async ({ where }: any) =>
        runs.get(`${where.year}-${where.month}`) ?? null,
    ),
    create: jest.fn((v: any) => ({ ...v })),
    save: jest.fn(async (v: any) => {
      runs.set(`${v.year}-${v.month}`, v);
      return v;
    }),
  };
  const tasks: any[] = opts.tasks ?? [];
  const tasksRepo = {
    findOne: jest.fn(
      async ({ where }: any) =>
        tasks.find(
          (t) =>
            t.kind === where.kind &&
            t.kindPeriod === where.kindPeriod &&
            (!where.status || t.status === where.status),
        ) ?? null,
    ),
    create: jest.fn((v: any) => ({ id: `task-${tasks.length + 1}`, ...v })),
    save: jest.fn(async (v: any) => {
      tasks.push(v);
      return v;
    }),
    update: jest.fn(async (id: string, patch: any) => {
      const t = tasks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
      return { affected: 1 };
    }),
  };
  const template = {
    meetingsOfMonth: jest.fn(
      async (_c: string, y: number, m: number) => months[`${y}-${m}`] ?? [],
    ),
  };
  const planner = {
    prepare: jest.fn(async (_c: string, y: number, m: number) => {
      months[`${y}-${m}`] = [
        { id: `d-${y}-${m}-1`, publishedAt: null },
        { id: `d-${y}-${m}-2`, publishedAt: null },
      ];
      return { created: 2, withoutConductor: 0, skipped: {} };
    }),
  };
  const meetings = {
    publishMonth: jest.fn(async (_c: string, y: number, m: number) => {
      const list = months[`${y}-${m}`] ?? [];
      const n = list.filter((x) => x.publishedAt === null).length;
      list.forEach((x) => (x.publishedAt = NOW));
      return { published: n, notified: 1 };
    }),
  };
  const notifications = { notify: jest.fn(async () => undefined) };
  const svc = new FieldServiceAutomationService(
    { find: jest.fn(async () => [settings()]) } as any,
    runsRepo as any,
    {
      findOne: jest.fn(async () => ({ id: CONG, timezone: 'Europe/Berlin' })),
    } as any,
    tasksRepo as any,
    {
      find: jest.fn(async () => [{ userId: 'u-so' }, { userId: 'u-asst' }]),
    } as any,
    { find: jest.fn(async () => [{ id: 'p-so' }, { id: 'p-asst' }]) } as any,
    template as any,
    planner as any,
    meetings as any,
    notifications as any,
  );
  const pass = async (s: FieldServiceSettings, today: string) => {
    const out = { prepared: 0, reminded: 0, published: 0, tasksClosed: 0 };
    await svc.passFor(s, today, NOW, out);
    return out;
  };
  return { svc, pass, planner, meetings, notifications, tasks, runs, months };
}

describe('preparing the month on its own', () => {
  it('a month ahead: on 1 October November is prepared, the overseer gets a task and a message', async () => {
    const { pass, planner, notifications, tasks } = build();
    const out = await pass(settings(), '2026-10-01');
    expect(out.prepared).toBe(1);
    expect(planner.prepare).toHaveBeenCalledWith(CONG, 2026, 11, true);
    // December is two months off: not yet.
    expect(planner.prepare).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      kind: 'field_service_month',
      kindPeriod: '2026-11',
      status: 'open',
      dueDate: '2026-10-25',
    });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const input = (notifications.notify.mock.calls as any[])[0][0];
    expect(input.userIds).toEqual(['u-so', 'u-asst']);
    expect(input.text('ru').body).toContain('ноябрь 2026');
  });

  it('runs once: the next night prepares nothing again — even after the overseer deleted every draft', async () => {
    const { pass, planner, months } = build();
    await pass(settings(), '2026-10-01');
    // He threw the month away on purpose; the app must not bring it back.
    months['2026-11'] = [];
    await pass(settings(), '2026-10-02');
    expect(planner.prepare).toHaveBeenCalledTimes(1);
  });

  it('two weeks ahead, and two months ahead, each on its own day', async () => {
    const a = build();
    await a.pass(settings({ prepareLead: '2w' }), '2026-10-17');
    expect(a.planner.prepare).not.toHaveBeenCalled();
    await a.pass(settings({ prepareLead: '2w' }), '2026-10-18');
    expect(a.planner.prepare).toHaveBeenCalledWith(CONG, 2026, 11, true);
    const b = build();
    await b.pass(settings({ prepareLead: '2m' }), '2026-10-01');
    expect(b.planner.prepare.mock.calls.map((c) => c[2])).toEqual([11, 12]);
  });

  it('a month the overseer prepared by hand is left alone, and «off» prepares nothing', async () => {
    const { pass, planner } = build({
      months: { '2026-11': [{ id: 'm', publishedAt: null }] },
    });
    await pass(settings(), '2026-10-01');
    expect(planner.prepare).not.toHaveBeenCalled();
    const b = build();
    await b.pass(settings({ autoPrepare: false }), '2026-10-01');
    expect(b.planner.prepare).not.toHaveBeenCalled();
  });

  it('conductors are left empty when the switch says so', async () => {
    const { pass, planner } = build();
    await pass(settings({ autoPickConductors: false }), '2026-10-01');
    expect(planner.prepare).toHaveBeenCalledWith(CONG, 2026, 11, false);
  });
});

describe('the draft nobody published', () => {
  // A fresh draft for each test: publishing mutates it.
  const drafts = () => ({ '2026-11': [{ id: 'd1', publishedAt: null }] });

  it('is reminded about on the 24th and published on the 25th, each once', async () => {
    const { pass, meetings, notifications } = build({ months: drafts() });
    const s = settings({ autoPrepare: false });
    await pass(s, '2026-10-23');
    expect(notifications.notify).not.toHaveBeenCalled();
    const r1 = await pass(s, '2026-10-24');
    expect(r1.reminded).toBe(1);
    expect(meetings.publishMonth).not.toHaveBeenCalled();
    const body = (notifications.notify.mock.calls as any[])[0][0].text(
      'ru',
    ).body;
    expect(body).toContain('Завтра он опубликуется сам');
    const r2 = await pass(s, '2026-10-24');
    expect(r2.reminded).toBe(0);
    const r3 = await pass(s, '2026-10-25');
    expect(r3.published).toBe(1);
    expect(meetings.publishMonth).toHaveBeenCalledWith(CONG, 2026, 11);
    // Told that it happened.
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    await pass(s, '2026-10-26');
    expect(meetings.publishMonth).toHaveBeenCalledTimes(1);
  });

  it('with «only remind», the reminder comes on the 25th and nothing is published', async () => {
    const { pass, meetings, notifications } = build({ months: drafts() });
    const s = settings({ autoPrepare: false, unpublishedPolicy: 'remind' });
    await pass(s, '2026-10-24');
    expect(notifications.notify).not.toHaveBeenCalled();
    await pass(s, '2026-10-25');
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    await pass(s, '2026-10-31');
    expect(meetings.publishMonth).not.toHaveBeenCalled();
  });

  it('a month already published needs no reminder, and its task closes by itself', async () => {
    const task = {
      id: 'task-x',
      kind: 'field_service_month',
      kindPeriod: '2026-11',
      status: 'open',
      doneById: null,
    };
    const { pass, notifications, tasks } = build({
      months: { '2026-11': [{ id: 'p1', publishedAt: NOW }] },
      tasks: [task],
    });
    const out = await pass(settings({ autoPrepare: false }), '2026-10-24');
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(out.tasksClosed).toBe(1);
    expect(tasks[0].status).toBe('done');
  });

  it('a task a person closed is not touched', async () => {
    const task = {
      id: 'task-x',
      kind: 'field_service_month',
      kindPeriod: '2026-11',
      status: 'done',
      doneById: 'u-so',
    };
    const { pass, tasks } = build({
      months: { '2026-11': [{ id: 'p1', publishedAt: NOW }] },
      tasks: [task],
    });
    const out = await pass(settings({ autoPrepare: false }), '2026-10-24');
    expect(out.tasksClosed).toBe(0);
    expect(tasks[0].doneById).toBe('u-so');
  });
});
