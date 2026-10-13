import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { clockStub } from '../common/testing/clock-stub';

jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

/**
 * The notice for everyone (13 October 2026).
 *
 * «Зал на ремонте — собираемся у входа в парк» is about the reader's own
 * Saturday, so — unlike the schedule in general — it is told to everyone
 * the meeting concerns: a group's meeting to that group, the congregation's
 * and «по группам» to all. A draft stays silent until the month is
 * announced; clearing a notice says nothing; rewording it through an
 * evening is one message per person, by key.
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
  // Two in group g-1, one in g-2, one with no login at all.
  const cards: Record<string, unknown>[] = [
    { id: 'p-a', userId: 'u-a', serviceGroupId: 'g-1', ...CARD },
    { id: 'p-b', userId: 'u-b', serviceGroupId: 'g-1', ...CARD },
    { id: 'p-c', userId: 'u-c', serviceGroupId: 'g-2', ...CARD },
    { id: 'p-nologin', userId: null, serviceGroupId: 'g-2', ...CARD },
  ];
  const pubRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      where.congregationId === CONG
        ? (cards.find((c) => c.id === where.id) ?? null)
        : null,
    ),
    find: jest.fn(async ({ where }: any) => {
      if (where.id) {
        const ids: string[] = where.id?._value ?? where.id?.value ?? [];
        return cards.filter((c) => ids.includes(c.id as string));
      }
      return cards.filter(
        (c) =>
          where.congregationId === CONG &&
          (!where.serviceGroupId || c.serviceGroupId === where.serviceGroupId),
      );
    }),
  };
  const groupsRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      ['g-1', 'g-2'].includes(where.id)
        ? { id: where.id, congregationId: CONG }
        : null,
    ),
    find: jest.fn(async () => [
      { id: 'g-1', name: 'Север' },
      { id: 'g-2', name: 'Юг' },
    ]),
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
  return { svc, repo, audit, notify, qb };
}

let nowSpy: jest.SpyInstance;
beforeEach(() => {
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => nowSpy.mockRestore());

const row = (id: string, extra: Record<string, unknown>): Row => ({
  id,
  congregationId: CONG,
  // Sat 17 Oct.
  weekStartDate: '2026-10-12',
  dayOfWeek: 6,
  startTime: '10:30',
  address: 'Hall',
  conductorPublisherId: null,
  topic: null,
  notice: null,
  isGeneral: false,
  serviceGroupId: null,
  serviceOverseerVisit: false,
  serviceOverseerPublisherId: null,
  serviceOverseerAssistantId: null,
  publishedAt: new Date('2026-10-01T10:00:00Z'),
  ...extra,
});

const noticeCalls = (notify: { notify: jest.Mock }) =>
  notify.notify.mock.calls
    .map((c) => c[0])
    .filter((i) => i.kind === 'field_service_notice');

describe('the notice for everyone', () => {
  it('is stored trimmed, and blank means none', async () => {
    const { svc, repo } = build();
    await svc.create(CONG, {
      weekStartDate: '2026-10-12',
      dayOfWeek: 6,
      startTime: '10:30',
      address: 'Hall',
      notice: '  Зал на ремонте  ',
      draft: true,
    } as any);
    expect((repo.save.mock.calls[0][0] as any).notice).toBe('Зал на ремонте');
    await svc.create(CONG, {
      weekStartDate: '2026-10-12',
      dayOfWeek: 6,
      startTime: '10:30',
      address: 'Hall',
      notice: '   ',
      draft: true,
    } as any);
    expect((repo.save.mock.calls[1][0] as any).notice).toBeNull();
  });

  it('on the congregation’s meeting goes to everyone with a login, once per day', async () => {
    const { svc, notify } = build([row('m-1', { isGeneral: true })]);
    await svc.update(CONG, 'm-1', { notice: 'Зал на ремонте' } as any);
    const calls = noticeCalls(notify);
    expect(calls).toHaveLength(1);
    expect([...calls[0].userIds].sort()).toEqual(['u-a', 'u-b', 'u-c']);
    expect(calls[0].key).toBe('field_service_notice:m-1:2026-10-09');
    const ru = calls[0].text('ru');
    expect(ru.body).toContain('17 окт.');
    expect(ru.body).toContain('10:30');
    expect(ru.body).toContain('Зал на ремонте');
    expect(calls[0].data.type).toBe('field_service_meeting');
    expect(calls[0].data.meetingId).toBe('m-1');
  });

  it('«по группам» (no group, not general) concerns everyone too', async () => {
    const { svc, notify } = build([row('m-1', {})]);
    await svc.update(CONG, 'm-1', { notice: 'Сбор у парка' } as any);
    expect([...noticeCalls(notify)[0].userIds].sort()).toEqual([
      'u-a',
      'u-b',
      'u-c',
    ]);
  });

  it('on a group’s meeting goes to that group only', async () => {
    const { svc, notify } = build([row('m-1', { serviceGroupId: 'g-1' })]);
    await svc.update(CONG, 'm-1', { notice: 'Сбор у парка' } as any);
    expect([...noticeCalls(notify)[0].userIds].sort()).toEqual(['u-a', 'u-b']);
  });

  it('an unchanged or cleared notice says nothing', async () => {
    const { svc, notify } = build([
      row('m-1', { isGeneral: true, notice: 'Зал на ремонте' }),
    ]);
    await svc.update(CONG, 'm-1', { startTime: '11:00' } as any);
    await svc.update(CONG, 'm-1', { notice: 'Зал на ремонте' } as any);
    await svc.update(CONG, 'm-1', { notice: '' } as any);
    expect(noticeCalls(notify)).toHaveLength(0);
  });

  it('on a draft waits for the month to be announced', async () => {
    const draft = row('m-nov', {
      isGeneral: true,
      weekStartDate: '2026-11-02',
      publishedAt: null,
    });
    const { svc, notify } = build([draft]);
    await svc.update(CONG, 'm-nov', { notice: 'Зал на ремонте' } as any);
    expect(noticeCalls(notify)).toHaveLength(0);
    draft.notice = 'Зал на ремонте';
    await svc.publishMonth(CONG, 2026, 11);
    const calls = noticeCalls(notify);
    expect(calls).toHaveLength(1);
    expect(calls[0].text('de').body).toContain('Зал на ремонте');
  });

  it('a meeting made by hand with a notice tells everyone at once', async () => {
    const { svc, notify } = build();
    await svc.create(CONG, {
      weekStartDate: '2026-10-12',
      dayOfWeek: 6,
      startTime: '10:30',
      address: 'Hall',
      isGeneral: true,
      notice: 'Зал на ремонте',
    } as any);
    expect(noticeCalls(notify)).toHaveLength(1);
  });
});
