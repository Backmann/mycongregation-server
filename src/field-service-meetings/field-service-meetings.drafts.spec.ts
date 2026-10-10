import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { clockStub } from '../common/testing/clock-stub';
import { UserRole } from '../common/enums/user-role.enum';

jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

/**
 * A month prepared and not yet announced (October 2026).
 *
 * A draft is told to nobody — not when it is made, not when its conductor
 * changes, not when it is deleted. The month is announced once, by
 * publishMonth, and then each person hears ONE message with all his dates.
 */

const CONG = 'cong-1';
// Friday 9 October 2026, mid-morning in Berlin.
const NOW = Date.parse('2026-10-09T08:00:00Z');

const CARD = {
  isActive: true,
  capabilities: { fs_meeting_conductor: true },
};

type Row = Record<string, unknown> & { id: string };

function build(rows: Row[] = []) {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    addOrderBy: jest.fn(() => qb),
    getMany: jest.fn(async () => rows.map((r) => ({ ...r }))),
  };
  const repo = {
    create: jest.fn((v: unknown) => v),
    save: jest.fn(async (v: Record<string, unknown>) => ({
      id: 'new',
      ...v,
    })),
    findOne: jest.fn(async ({ where }: any) => {
      const r = rows.find((x) => x.id === where.id);
      return r ? { ...r } : null;
    }),
    delete: jest.fn(async () => ({ affected: 1 })),
    update: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => qb),
  };
  const cards: Record<string, unknown>[] = [
    { id: 'p-a', userId: 'u-a', ...CARD },
    { id: 'p-b', userId: 'u-b', ...CARD },
    { id: 'p-so', userId: 'u-so', isActive: true, capabilities: {} },
    { id: 'p-nologin', userId: null, ...CARD },
  ];
  const pubRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      where.congregationId === CONG
        ? (cards.find((c) => c.id === where.id) ?? null)
        : null,
    ),
    find: jest.fn(async ({ where }: any) => {
      const ids: string[] = where.id?._value ?? where.id?.value ?? [];
      return cards.filter((c) => ids.includes(c.id as string));
    }),
  };
  const groupsRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      where.id === 'g-1' ? { id: 'g-1', congregationId: CONG } : null,
    ),
    find: jest.fn(async () => [{ id: 'g-1', name: 'Верне' }]),
  };
  const audit = {
    logCreate: jest.fn(),
    logUpdate: jest.fn(),
    logEvent: jest.fn(),
  };
  const notify = { notify: jest.fn().mockResolvedValue(undefined) };
  const resp = { count: jest.fn(async () => 0) };
  const svc = new FieldServiceMeetingsService(
    repo as any,
    pubRepo as any,
    {} as any,
    notify as any,
    audit as any,
    clockStub(),
    groupsRepo as any,
    resp as any,
  );
  return { svc, repo, audit, notify, resp, qb };
}

let nowSpy: jest.SpyInstance;
beforeEach(() => {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => nowSpy.mockRestore());

const nextSaturday = {
  weekStartDate: '2026-10-12',
  dayOfWeek: 6,
  startTime: '10:30',
  address: 'Hall',
};

describe('a draft is told to nobody', () => {
  it('a meeting made by hand is announced at once, and its conductor told', async () => {
    const { svc, repo, notify } = build();
    await svc.create(CONG, {
      ...nextSaturday,
      conductorPublisherId: 'p-a',
    } as any);
    const saved = repo.save.mock.calls[0][0] as { publishedAt: unknown };
    expect(saved.publishedAt).toBeInstanceOf(Date);
    expect(notify.notify).toHaveBeenCalledTimes(1);
  });

  it('a meeting made as a draft has no publishedAt and tells nobody', async () => {
    const { svc, repo, notify, audit } = build();
    await svc.create(CONG, {
      ...nextSaturday,
      conductorPublisherId: 'p-a',
      draft: true,
    } as any);
    const saved = repo.save.mock.calls[0][0] as { publishedAt: unknown };
    expect(saved.publishedAt).toBeNull();
    expect(notify.notify).not.toHaveBeenCalled();
    // The journal says it was a draft: a reader asking why nobody was told
    // finds the answer there.
    expect(audit.logCreate.mock.calls[0][0].after.draft).toBe(true);
  });

  it('a draft visit tells neither the overseer nor his assistant', async () => {
    const { svc, notify } = build();
    await svc.create(CONG, {
      ...nextSaturday,
      serviceGroupId: 'g-1',
      serviceOverseerVisit: true,
      serviceOverseerPublisherId: 'p-so',
      serviceOverseerAssistantId: 'p-b',
      conductorPublisherId: 'p-so',
      draft: true,
    } as any);
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('changing the conductor of a draft tells neither the old nor the new one', async () => {
    const draft = {
      id: 'm-d',
      congregationId: CONG,
      ...nextSaturday,
      conductorPublisherId: 'p-a',
      publishedAt: null,
      isGeneral: false,
      serviceGroupId: null,
      serviceOverseerVisit: false,
      serviceOverseerPublisherId: null,
      serviceOverseerAssistantId: null,
    };
    const { svc, notify } = build([draft]);
    await svc.update(CONG, 'm-d', { conductorPublisherId: 'p-b' } as any);
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it('the same change on an announced meeting tells both, as before', async () => {
    const live = {
      id: 'm-l',
      congregationId: CONG,
      ...nextSaturday,
      conductorPublisherId: 'p-a',
      publishedAt: new Date(NOW),
      isGeneral: false,
      serviceGroupId: null,
      serviceOverseerVisit: false,
      serviceOverseerPublisherId: null,
      serviceOverseerAssistantId: null,
    };
    const { svc, notify } = build([live]);
    await svc.update(CONG, 'm-l', { conductorPublisherId: 'p-b' } as any);
    expect(notify.notify).toHaveBeenCalledTimes(2);
  });

  it('deleting a draft is no cancellation for anybody', async () => {
    const draft = {
      id: 'm-d',
      congregationId: CONG,
      ...nextSaturday,
      conductorPublisherId: 'p-a',
      publishedAt: null,
      serviceOverseerVisit: true,
      serviceOverseerAssistantId: 'p-b',
    };
    const { svc, notify, repo } = build([draft]);
    await svc.remove(CONG, 'm-d');
    expect(repo.delete).toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });
});

describe('publishing a month', () => {
  const nov = (id: string, extra: Record<string, unknown>) => ({
    id,
    congregationId: CONG,
    dayOfWeek: 6,
    startTime: '10:30',
    address: 'Hall',
    serviceGroupId: null,
    serviceOverseerVisit: false,
    serviceOverseerPublisherId: null,
    serviceOverseerAssistantId: null,
    publishedAt: null,
    ...extra,
  });

  it('announces the drafts of that month only — not another month, not a day gone', async () => {
    const rows = [
      // Sat 7 Nov — draft, in.
      nov('m-7', { weekStartDate: '2026-11-02', conductorPublisherId: 'p-a' }),
      // Sat 21 Nov — draft, in.
      nov('m-21', { weekStartDate: '2026-11-16', conductorPublisherId: 'p-a' }),
      // Sat 31 Oct — the week of Monday 26 Oct crosses into November's query
      // span only because the 1st is a Sunday; the day itself is October.
      nov('m-oct', {
        weekStartDate: '2026-10-26',
        conductorPublisherId: 'p-b',
      }),
      // Sat 5 Dec — the week of Monday 30 Nov; the day is December.
      nov('m-dec', {
        weekStartDate: '2026-11-30',
        conductorPublisherId: 'p-b',
      }),
    ];
    const { svc, repo, notify } = build(rows);
    const out = await svc.publishMonth(CONG, 2026, 11);
    expect(out.published).toBe(2);
    const [where, patch] = repo.update.mock.calls[0] as any[];
    expect(where.id._value ?? where.id.value).toEqual(['m-7', 'm-21']);
    expect(patch.publishedAt).toBeInstanceOf(Date);
    // One person, one message, both dates in it.
    expect(notify.notify).toHaveBeenCalledTimes(1);
    const input = notify.notify.mock.calls[0][0];
    expect(input.userIds).toEqual(['u-a']);
    const ru = input.text('ru');
    expect(ru.body).toContain('7 нояб.');
    expect(ru.body).toContain('21 нояб.');
    expect(ru.body).not.toContain('5 дек.');
    expect(input.emailFallback).toBe(true);
    expect(input.data.type).toBe('field_service_meeting');
  });

  it('a draft whose day is already gone stays a draft', async () => {
    const rows = [
      // Sat 3 Oct — gone; Sat 10 Oct — tomorrow.
      nov('m-3', { weekStartDate: '2026-09-28', conductorPublisherId: 'p-a' }),
      nov('m-10', { weekStartDate: '2026-10-05', conductorPublisherId: 'p-a' }),
    ];
    const { svc, repo } = build(rows);
    const out = await svc.publishMonth(CONG, 2026, 10);
    expect(out.published).toBe(1);
    const [where] = repo.update.mock.calls[0] as any[];
    expect(where.id._value ?? where.id.value).toEqual(['m-10']);
  });

  it('on a visit the assistant hears too, with his part named, and a man with no login is skipped', async () => {
    const rows = [
      nov('m-v', {
        weekStartDate: '2026-11-02',
        serviceGroupId: 'g-1',
        serviceOverseerVisit: true,
        serviceOverseerPublisherId: 'p-so',
        serviceOverseerAssistantId: 'p-b',
        conductorPublisherId: 'p-so',
      }),
      nov('m-x', {
        weekStartDate: '2026-11-16',
        conductorPublisherId: 'p-nologin',
      }),
    ];
    const { svc, notify } = build(rows);
    const out = await svc.publishMonth(CONG, 2026, 11);
    expect(out.published).toBe(2);
    expect(out.notified).toBe(2);
    const to = notify.notify.mock.calls.map((c) => c[0].userIds[0]).sort();
    expect(to).toEqual(['u-b', 'u-so']);
    const toB = notify.notify.mock.calls.find((c) => c[0].userIds[0] === 'u-b');
    const de = toB![0].text('de');
    expect(de.body).toContain('Верне');
    expect(de.body).toContain('Gehilfe beim Besuch');
  });

  it('nothing to announce: no update, no message', async () => {
    const { svc, repo, notify } = build([]);
    const out = await svc.publishMonth(CONG, 2026, 11);
    expect(out).toEqual({ published: 0, notified: 0 });
    expect(repo.update).not.toHaveBeenCalled();
    expect(notify.notify).not.toHaveBeenCalled();
  });
});

describe('who may see a draft', () => {
  const user = (role: UserRole) =>
    ({ id: 'u', role, congregationId: CONG }) as any;

  it('an administrator always', async () => {
    const { svc, resp } = build();
    expect(await svc.canPlan(user(UserRole.ADMIN))).toBe(true);
    expect(resp.count).not.toHaveBeenCalled();
  });

  it('otherwise only the service overseer or his assistant', async () => {
    const { svc, resp } = build();
    expect(await svc.canPlan(user(UserRole.ELDER))).toBe(false);
    resp.count.mockResolvedValueOnce(1);
    expect(await svc.canPlan(user(UserRole.PUBLISHER))).toBe(true);
  });
});
