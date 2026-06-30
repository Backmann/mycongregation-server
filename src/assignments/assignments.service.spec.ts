import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';
import { DutiesService } from '../duties/duties.service';

// expo-server-sdk (pulled in transitively by the real push service) is
// ESM-only and breaks under Jest. Mock the module: the DI token stays the
// same class identity via the Jest module registry.
jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function makeQb() {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'withDeleted',
    'update',
    'set',
  ]) {
    qb[m] = jest.fn().mockReturnThis();
  }
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
  return qb;
}

const member = {
  id: 'u-member',
  congregationId: 'c1',
  role: 'publisher',
} as unknown as AuthenticatedUser;

const admin = {
  id: 'u-admin',
  congregationId: 'c1',
  role: 'admin',
} as unknown as AuthenticatedUser;

describe('AssignmentsService draft visibility', () => {
  let service: AssignmentsService;
  let repo: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let responsibilitiesRepo: { count: jest.Mock };
  let pushMock: {
    sendSchedulePublished: jest.Mock;
    sendScheduleChanged: jest.Mock;
  };
  let qb: ReturnType<typeof makeQb>;

  beforeEach(async () => {
    qb = makeQb();
    repo = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    responsibilitiesRepo = { count: jest.fn().mockResolvedValue(0) };
    pushMock = {
      sendSchedulePublished: jest.fn(),
      sendScheduleChanged: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: getRepositoryToken(Assignment), useValue: repo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilitiesRepo,
        },
        {
          provide: getRepositoryToken(Publisher),
          useValue: { findOne: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: getRepositoryToken(Congregation),
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({ assignmentAutomationEnabled: false }),
          },
        },
        { provide: PushNotificationsService, useValue: pushMock },
        {
          provide: TalkExchangeService,
          useValue: { syncProgramToJournal: jest.fn() },
        },
        {
          provide: DutiesService,
          useValue: { reconcileTreasuresMic: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    service = moduleRef.get(AssignmentsService);
  });

  it('forces published-only for a plain member, even if drafts were requested', async () => {
    await service.list(
      'c1',
      { status: 'draft', includeRemoved: true } as never,
      member,
    );
    expect(qb.andWhere).toHaveBeenCalledWith("a.status = 'published'");
    expect(qb.andWhere).not.toHaveBeenCalledWith('a.status = :status', {
      status: 'draft',
    });
    expect(qb.withDeleted).not.toHaveBeenCalled();
  });

  it('lets an admin filter by any status and see removed rows', async () => {
    await service.list(
      'c1',
      { status: 'draft', includeRemoved: true } as never,
      admin,
    );
    expect(qb.andWhere).toHaveBeenCalledWith('a.status = :status', {
      status: 'draft',
    });
    expect(qb.withDeleted).toHaveBeenCalled();
    expect(responsibilitiesRepo.count).not.toHaveBeenCalled();
  });

  it('treats a schedule-responsibility holder as an editor', async () => {
    responsibilitiesRepo.count.mockResolvedValue(1);
    await service.list('c1', { status: 'draft' } as never, member);
    expect(qb.andWhere).toHaveBeenCalledWith('a.status = :status', {
      status: 'draft',
    });
  });

  it('trusts internal callers without a user context', async () => {
    await service.list('c1', { status: 'draft' } as never);
    expect(qb.andWhere).toHaveBeenCalledWith('a.status = :status', {
      status: 'draft',
    });
    expect(responsibilitiesRepo.count).not.toHaveBeenCalled();
  });

  it('hides a draft from a member in getById as if it did not exist', async () => {
    repo.findOne.mockResolvedValue({
      id: 'a1',
      status: 'draft',
      deletedAt: null,
    });
    await expect(service.getById('c1', 'a1', member)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns a published assignment to a member without a responsibilities lookup', async () => {
    repo.findOne.mockResolvedValue({
      id: 'a2',
      status: 'published',
      deletedAt: null,
    });
    const res = await service.getById('c1', 'a2', member);
    expect(res.id).toBe('a2');
    expect(responsibilitiesRepo.count).not.toHaveBeenCalled();
  });

  it('shows a draft to an editor in getById', async () => {
    responsibilitiesRepo.count.mockResolvedValue(1);
    repo.findOne.mockResolvedValue({
      id: 'a3',
      status: 'draft',
      deletedAt: null,
    });
    const res = await service.getById('c1', 'a3', member);
    expect(res.id).toBe('a3');
  });

  it('publishes every draft of one meeting and reports the count', async () => {
    qb.execute.mockResolvedValue({ affected: 3 });
    const res = await service.publishMeeting(
      'c1',
      '2026-06-08',
      'midweek' as never,
    );
    expect(res).toEqual({ published: 3 });
    expect(qb.set).toHaveBeenCalledWith({ status: 'published' });
    expect(qb.andWhere).toHaveBeenCalledWith("status = 'draft'");
    expect(qb.andWhere).toHaveBeenCalledWith('deletedAt IS NULL');
    expect(pushMock.sendSchedulePublished).toHaveBeenCalledWith(
      'c1',
      'midweek',
      '2026-06-08',
    );
  });

  it('reports zero when the meeting has no drafts', async () => {
    qb.execute.mockResolvedValue({ affected: 0 });
    const res = await service.publishMeeting(
      'c1',
      '2026-06-08',
      'weekend' as never,
    );
    expect(res).toEqual({ published: 0 });
    expect(pushMock.sendSchedulePublished).not.toHaveBeenCalled();
  });

  it('does not push for non-meeting sections', async () => {
    qb.execute.mockResolvedValue({ affected: 2 });
    const res = await service.publishMeeting(
      'c1',
      '2026-06-08',
      'cleaning' as never,
    );
    expect(res).toEqual({ published: 2 });
    expect(pushMock.sendSchedulePublished).not.toHaveBeenCalled();
  });

  it('notifies about changes, clears flags and lists changed part titles', async () => {
    repo.find.mockResolvedValue([
      { id: 'a1', partTitle: 'Начало разговора', partOrder: 4 },
      { id: 'a2', partTitle: null, partOrder: 7 },
    ]);
    qb.execute.mockResolvedValue({ affected: 2 });
    const res = await service.notifyChanges(
      'c1',
      '2026-06-08',
      'weekend' as never,
    );
    expect(res).toEqual({ notified: 2 });
    expect(qb.set).toHaveBeenCalledWith({ changedSincePublish: false });
    expect(pushMock.sendScheduleChanged).toHaveBeenCalledWith(
      'c1',
      'weekend',
      '2026-06-08',
      'Начало разговора',
    );
  });

  it('does nothing when no assignments are flagged as changed', async () => {
    repo.find.mockResolvedValue([]);
    const res = await service.notifyChanges(
      'c1',
      '2026-06-08',
      'midweek' as never,
    );
    expect(res).toEqual({ notified: 0 });
    expect(pushMock.sendScheduleChanged).not.toHaveBeenCalled();
  });
});
