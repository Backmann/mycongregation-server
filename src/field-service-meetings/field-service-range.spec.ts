import { FieldServiceMeetingsService } from './field-service-meetings.service';

// expo-server-sdk (pulled in via the push service) is ESM-only and breaks
// under Jest — mock the module before the service import resolves it.
jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

/**
 * Adding an upper bound must not change what the door does without one: every
 * caller today passes a single week and expects that week only.
 */

function build() {
  const where: { sql: string; params: Record<string, unknown> }[] = [];
  const qb = {
    where: (sql: string, params: Record<string, unknown>) => {
      where.push({ sql, params });
      return qb;
    },
    andWhere: (sql: string, params: Record<string, unknown>) => {
      where.push({ sql, params });
      return qb;
    },
    orderBy: () => qb,
    addOrderBy: () => qb,
    getMany: () => Promise.resolve([]),
  };
  const repo = { createQueryBuilder: () => qb };
  const service = new FieldServiceMeetingsService(
    repo as never,
    { findOne: jest.fn() } as never,
    { sendToUsers: jest.fn() } as never,
    { notify: jest.fn() } as never,
    {
      logCreate: jest.fn(),
      logUpdate: jest.fn(),
      logEvent: jest.fn(),
    } as never,
    {} as never,
  );
  return { service, where };
}

const sqlOf = (where: { sql: string }[]) => where.map((w) => w.sql).join(' | ');

describe('FieldServiceMeetingsService.list', () => {
  it('still asks for one exact week when no upper bound is given', async () => {
    const { service, where } = build();
    await service.list('c1', { weekStart: '2026-09-14' } as never);
    expect(sqlOf(where)).toContain('m.weekStartDate = :weekStart');
    expect(sqlOf(where)).not.toContain('weekEnd');
  });

  it('reads a span when both bounds are given', async () => {
    const { service, where } = build();
    await service.list('c1', {
      weekStart: '2026-09-07',
      weekEnd: '2026-09-28',
    } as never);
    expect(sqlOf(where)).toContain('m.weekStartDate >= :weekStart');
    expect(sqlOf(where)).toContain('m.weekStartDate < :weekEnd');
    expect(sqlOf(where)).not.toContain('m.weekStartDate = :weekStart');
  });

  it('narrows by nothing at all when no week is given', async () => {
    const { service, where } = build();
    await service.list('c1', {} as never);
    expect(sqlOf(where)).not.toContain('weekStartDate');
  });
});
