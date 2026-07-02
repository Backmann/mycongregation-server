import { NotFoundException } from '@nestjs/common';
import { FieldServiceMeetingsService } from './field-service-meetings.service';

// expo-server-sdk (pulled in via the push service) is ESM-only and breaks
// under Jest — mock the module before the service import resolves it.
jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));

const pubRepoMock = { findOne: jest.fn().mockResolvedValue(null) } as any;
const pushMock = { sendToUsers: jest.fn().mockResolvedValue(undefined) } as any;

/** Minimal chainable query-builder mock. */
function makeQb(result: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere', 'orderBy', 'addOrderBy']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn(async () => result);
  return qb;
}

const CONG = '11111111-1111-1111-1111-111111111111';

describe('FieldServiceMeetingsService', () => {
  it('list() scopes by congregation, filters by week, orders by day then time', async () => {
    const qb = makeQb([{ id: 'm1' }]);
    const repo = { createQueryBuilder: jest.fn(() => qb) } as any;
    const svc = new FieldServiceMeetingsService(repo, pubRepoMock, pushMock);

    const out = await svc.list(CONG, { weekStart: '2026-05-18' });

    expect(repo.createQueryBuilder).toHaveBeenCalledWith('m');
    expect(qb.where).toHaveBeenCalledWith(
      'm.congregationId = :congregationId',
      {
        congregationId: CONG,
      },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('m.weekStartDate = :weekStart', {
      weekStart: '2026-05-18',
    });
    expect(qb.addOrderBy).toHaveBeenCalledWith('m.dayOfWeek', 'ASC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('m.startTime', 'ASC');
    expect(out).toEqual([{ id: 'm1' }]);
  });

  it('list() omits the week filter when weekStart is absent', async () => {
    const qb = makeQb([]);
    const repo = { createQueryBuilder: jest.fn(() => qb) } as any;
    const svc = new FieldServiceMeetingsService(repo, pubRepoMock, pushMock);

    await svc.list(CONG, {});

    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('create() defaults optional fields to null and stamps the tenant id', async () => {
    const repo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: Record<string, unknown>) => ({
        ...v,
        id: 'new',
      })),
    } as any;
    const svc = new FieldServiceMeetingsService(repo, pubRepoMock, pushMock);

    const out = await svc.create(CONG, {
      weekStartDate: '2026-05-18',
      dayOfWeek: 2,
      startTime: '10:00',
      address: 'City park, main gate',
    } as any);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        congregationId: CONG,
        conductorPublisherId: null,
        topic: null,
        sourceUrl: null,
      }),
    );
    expect(out.id).toBe('new');
  });

  it('update() throws NotFound when the row is missing for this tenant', async () => {
    const repo = { findOne: jest.fn(async () => null) } as any;
    const svc = new FieldServiceMeetingsService(repo, pubRepoMock, pushMock);

    await expect(
      svc.update(CONG, 'missing', { startTime: '11:00' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'missing', congregationId: CONG },
    });
  });

  it('update() applies only the provided fields and can clear topic', async () => {
    const row = {
      id: 'm1',
      startTime: '10:00',
      address: 'A',
      topic: 'old',
    } as any;
    const repo = {
      findOne: jest.fn(async () => row),
      save: jest.fn(async (v: unknown) => v),
    } as any;
    const svc = new FieldServiceMeetingsService(repo, pubRepoMock, pushMock);

    const out = await svc.update(CONG, 'm1', {
      startTime: '11:30',
      topic: null,
    } as any);

    expect(out.startTime).toBe('11:30');
    expect(out.topic).toBeNull();
    expect(out.address).toBe('A');
  });

  it('remove() throws NotFound when the row is missing for this tenant', async () => {
    const repo = {
      findOne: jest.fn(async () => null),
      delete: jest.fn(),
    } as any;
    const svc = new FieldServiceMeetingsService(repo, pubRepoMock, pushMock);

    await expect(svc.remove(CONG, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'missing', congregationId: CONG },
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });
});

describe('FieldServiceMeetingsService conductor pushes', () => {
  const meetingRow = {
    id: 'm1',
    congregationId: CONG,
    weekStartDate: '2026-07-06',
    dayOfWeek: 6,
    startTime: '10:30',
    address: 'Ostenallee 12, Hamm',
    conductorPublisherId: null as string | null,
    topic: null,
    sourceUrl: null,
    isGeneral: false,
  };

  function makePubRepo() {
    return {
      findOne: jest.fn(async () => ({
        id: 'p1',
        userId: 'u1',
        user: { uiLanguage: 'ru' },
      })),
    } as any;
  }
  function makePush() {
    return { sendToUsers: jest.fn().mockResolvedValue(undefined) } as any;
  }

  it('notifies the conductor when assigned on create', async () => {
    const repo = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: any) => ({ ...meetingRow, ...x })),
    } as any;
    const pubRepo = makePubRepo();
    const push = makePush();
    const svc = new FieldServiceMeetingsService(repo, pubRepo, push);

    await svc.create(CONG, {
      weekStartDate: '2026-07-06',
      dayOfWeek: 6,
      startTime: '10:30',
      address: 'Ostenallee 12, Hamm',
      conductorPublisherId: 'p1',
    } as any);

    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    const [tenant, userIds, , body] = push.sendToUsers.mock.calls[0];
    expect(tenant).toBe(CONG);
    expect(userIds).toEqual(['u1']);
    expect(body).toContain('11.07.2026');
    expect(body).toContain('10:30');
  });

  it('stays silent when notifyConductor=false', async () => {
    const repo = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: any) => ({ ...meetingRow, ...x })),
    } as any;
    const push = makePush();
    const svc = new FieldServiceMeetingsService(repo, makePubRepo(), push);

    await svc.create(CONG, {
      weekStartDate: '2026-07-06',
      dayOfWeek: 6,
      startTime: '10:30',
      address: 'A',
      conductorPublisherId: 'p1',
      notifyConductor: false,
    } as any);

    expect(push.sendToUsers).not.toHaveBeenCalled();
  });

  it('notifies both the old and the new conductor on change', async () => {
    const existing = { ...meetingRow, conductorPublisherId: 'p-old' };
    const repo = {
      findOne: jest.fn(async () => existing),
      save: jest.fn(async (x: any) => x),
    } as any;
    const pubRepo = {
      findOne: jest.fn(async ({ where }: any) => ({
        id: where.id,
        userId: `u-${where.id}`,
        user: { uiLanguage: 'ru' },
      })),
    } as any;
    const push = makePush();
    const svc = new FieldServiceMeetingsService(repo, pubRepo, push);

    await svc.update(CONG, 'm1', { conductorPublisherId: 'p-new' } as any);

    expect(push.sendToUsers).toHaveBeenCalledTimes(2);
    const targets = push.sendToUsers.mock.calls.map((c: any[]) => c[1][0]);
    expect(targets).toEqual(['u-p-old', 'u-p-new']);
  });

  it('notifies the conductor when the meeting is removed', async () => {
    const existing = { ...meetingRow, conductorPublisherId: 'p1' };
    const repo = {
      findOne: jest.fn(async () => existing),
      delete: jest.fn(async () => ({ affected: 1 })),
    } as any;
    const push = makePush();
    const svc = new FieldServiceMeetingsService(repo, makePubRepo(), push);

    await svc.remove(CONG, 'm1');

    expect(repo.delete).toHaveBeenCalled();
    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
  });

  it('skips the push silently when the publisher has no login', async () => {
    const repo = {
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: any) => ({ ...meetingRow, ...x })),
    } as any;
    const pubRepo = {
      findOne: jest.fn(async () => ({ id: 'p1', userId: null, user: null })),
    } as any;
    const push = makePush();
    const svc = new FieldServiceMeetingsService(repo, pubRepo, push);

    await svc.create(CONG, {
      weekStartDate: '2026-07-06',
      dayOfWeek: 6,
      startTime: '10:30',
      address: 'A',
      conductorPublisherId: 'p1',
    } as any);

    expect(push.sendToUsers).not.toHaveBeenCalled();
  });
});
