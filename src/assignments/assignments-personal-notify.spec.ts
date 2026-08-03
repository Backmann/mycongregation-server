jest.mock('expo-server-sdk', () => {
  class MockExpo {
    static isExpoPushToken() {
      return true;
    }
    chunkPushNotifications(m: unknown[]) {
      return [m];
    }
    sendPushNotificationsAsync = jest.fn().mockResolvedValue([]);
  }
  return { Expo: MockExpo };
});

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AssignmentsService } from './assignments.service';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';
import { DutiesService } from '../duties/duties.service';
import { LocalNeedsService } from '../local-needs/local-needs.service';

/**
 * The programme used to be announced to everyone with a phone. Now the
 * notification IS the answer: you hear your own parts, or you hear nothing.
 */
describe('AssignmentsService — telling each assignee their own parts', () => {
  const WEEK = '2026-06-08';

  function build(rows: Partial<Assignment>[], publishers: any[], users: any[]) {
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: rows.length }),
    };
    const repo = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue(rows),
      manager: { find: jest.fn().mockResolvedValue(users) },
    };
    const notify = { notify: jest.fn().mockResolvedValue(undefined) };
    return {
      repo,
      notify,
      publishersRepo: { find: jest.fn().mockResolvedValue(publishers) },
    };
  }

  async function makeService(parts: {
    repo: any;
    notify: any;
    publishersRepo: any;
  }) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: getRepositoryToken(Assignment), useValue: parts.repo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: { count: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: getRepositoryToken(Publisher),
          useValue: parts.publishersRepo,
        },
        {
          provide: getRepositoryToken(Congregation),
          useValue: { findOne: jest.fn().mockResolvedValue({}) },
        },
        { provide: PushNotificationsService, useValue: {} },
        { provide: NotificationsService, useValue: parts.notify },
        {
          provide: TalkExchangeService,
          useValue: { syncProgramToJournal: jest.fn() },
        },
        {
          provide: AuditLogService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logEvent: jest.fn(),
            logFieldsChanged: jest.fn(),
          },
        },
        {
          provide: DutiesService,
          useValue: { reconcileTreasuresMic: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: LocalNeedsService,
          useValue: { releaseAssignment: jest.fn() },
        },
      ],
    }).compile();
    return moduleRef.get(AssignmentsService);
  }

  it('names the part, in the reader’s own language', async () => {
    const parts = build(
      [
        {
          partKey: 'bible_reading',
          partTitle: null,
          publisherId: 'p1',
          assistantPublisherId: null,
        } as Partial<Assignment>,
      ],
      [{ id: 'p1', userId: 'u1' }],
      [{ id: 'u1', uiLanguage: 'ru' }],
    );
    const service = await makeService(parts);

    await service.publishMeeting('c1', WEEK, 'midweek' as never);
    await new Promise((r) => setImmediate(r));

    expect(parts.notify.notify).toHaveBeenCalledTimes(1);
    const arg = parts.notify.notify.mock.calls[0][0];
    expect(arg.userIds).toEqual(['u1']);
    expect(arg.title).toBe('Вам назначено');
    expect(arg.body).toContain('Чтение Библии');
    expect(arg.kind).toBe('schedule');
  });

  it('prefers the part’s own title when it has one', async () => {
    const parts = build(
      [
        {
          partKey: 'public_talk_speaker',
          partTitle: 'Верность в мелочах',
          publisherId: 'p1',
          assistantPublisherId: null,
        } as Partial<Assignment>,
      ],
      [{ id: 'p1', userId: 'u1' }],
      [{ id: 'u1', uiLanguage: 'ru' }],
    );
    const service = await makeService(parts);

    await service.publishMeeting('c1', WEEK, 'weekend' as never);
    await new Promise((r) => setImmediate(r));

    expect(parts.notify.notify.mock.calls[0][0].body).toContain(
      'Верность в мелочах',
    );
  });

  // The reason for the whole change: silence for those it does not concern.
  it('tells nobody when nobody is assigned', async () => {
    const parts = build([], [], []);
    const service = await makeService(parts);

    await service.publishMeeting('c1', WEEK, 'midweek' as never);
    await new Promise((r) => setImmediate(r));

    expect(parts.notify.notify).not.toHaveBeenCalled();
  });

  it('counts an assistant as an assignee — being the reader is an assignment', async () => {
    const parts = build(
      [
        {
          partKey: 'cbs_conductor',
          partTitle: null,
          publisherId: 'p1',
          assistantPublisherId: 'p2',
        } as Partial<Assignment>,
      ],
      [
        { id: 'p1', userId: 'u1' },
        { id: 'p2', userId: 'u2' },
      ],
      [
        { id: 'u1', uiLanguage: 'ru' },
        { id: 'u2', uiLanguage: 'ru' },
      ],
    );
    const service = await makeService(parts);

    await service.publishMeeting('c1', WEEK, 'midweek' as never);
    await new Promise((r) => setImmediate(r));

    const reached = parts.notify.notify.mock.calls.map(
      (c: any[]) => c[0].userIds[0],
    );
    expect(new Set(reached)).toEqual(new Set(['u1', 'u2']));
  });

  it('says nothing to someone without a login', async () => {
    const parts = build(
      [
        {
          partKey: 'bible_reading',
          partTitle: null,
          publisherId: 'p1',
          assistantPublisherId: null,
        } as Partial<Assignment>,
      ],
      [{ id: 'p1', userId: null }],
      [],
    );
    const service = await makeService(parts);

    await service.publishMeeting('c1', WEEK, 'midweek' as never);
    await new Promise((r) => setImmediate(r));

    expect(parts.notify.notify).not.toHaveBeenCalled();
  });
});
