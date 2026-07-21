import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { Publisher } from '../entities/publisher.entity';
import { Congregation } from '../entities/congregation.entity';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';
import { DutiesService } from '../duties/duties.service';

jest.mock('../push-notifications/push-notifications.service', () => ({
  PushNotificationsService: class PushNotificationsServiceMock {},
}));
jest.mock('../talk-exchange/talk-exchange.service', () => ({
  TalkExchangeService: class TalkExchangeServiceMock {},
}));

const CONG = 'cong-1';
const TALK_KEY = 'public_talk_speaker';

describe('AssignmentsService — journal sync coverage and public-talk swap', () => {
  let service: AssignmentsService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    softDelete: jest.Mock;
    restore: jest.Mock;
  };
  let sync: jest.Mock;

  beforeEach(async () => {
    repo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
      findOne: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
    };
    sync = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        {
          provide: AuditLogService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logEvent: jest.fn(),
            logFieldsChanged: jest.fn(),
          },
        },
        { provide: getRepositoryToken(Assignment), useValue: repo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: { count: jest.fn().mockResolvedValue(0) },
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
        {
          provide: PushNotificationsService,
          useValue: {
            sendSchedulePublished: jest.fn(),
            sendScheduleChanged: jest.fn(),
          },
        },
        {
          provide: TalkExchangeService,
          useValue: { syncProgramToJournal: sync },
        },
        {
          provide: DutiesService,
          useValue: { reconcileTreasuresMic: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    service = moduleRef.get(AssignmentsService);
  });

  it('create() of a public-talk slot syncs the journal', async () => {
    await service.create(CONG, {
      partKey: TALK_KEY,
      weekStartDate: '2026-07-13',
    } as never);
    expect(sync).toHaveBeenCalledWith(CONG, '2026-07-13');
  });

  it('create() of another part does NOT touch the journal', async () => {
    await service.create(CONG, {
      partKey: 'chairman',
      weekStartDate: '2026-07-13',
    } as never);
    expect(sync).not.toHaveBeenCalled();
  });

  it('remove() of a public-talk slot syncs the journal (ghost entry fix)', async () => {
    repo.findOne.mockResolvedValue({
      id: 'a1',
      congregationId: CONG,
      partKey: TALK_KEY,
      weekStartDate: '2026-07-13',
      deletedAt: null,
    });
    await service.remove(CONG, 'a1');
    expect(repo.softDelete).toHaveBeenCalled();
    expect(sync).toHaveBeenCalledWith(CONG, '2026-07-13');
  });

  describe('swapPublicTalk', () => {
    const src = () => ({
      id: 's',
      weekStartDate: '2026-07-13',
      partKey: TALK_KEY,
      publisherId: null,
      speakerName: 'Гость Будущий',
      speakerCongregation: 'Ahlen',
      publicTalkId: 'talk-7',
      status: 'published',
      changedSincePublish: false,
    });
    const tgt = () => ({
      id: 't',
      weekStartDate: '2026-07-06',
      partKey: TALK_KEY,
      publisherId: 'pub-local',
      speakerName: null,
      speakerCongregation: null,
      publicTalkId: 'talk-3',
      status: 'published',
      changedSincePublish: false,
    });

    function mockSlots(a: unknown, b: unknown) {
      repo.findOne.mockImplementation(
        async (opts: { where: { weekStartDate: string } }) =>
          opts.where.weekStartDate === '2026-07-13' ? a : b,
      );
    }

    it('swap exchanges both weeks and syncs both', async () => {
      const a = src();
      const b = tgt();
      mockSlots(a, b);
      const res = await service.swapPublicTalk(CONG, {
        eventType: 'weekend',
        sourceWeekStartDate: '2026-07-13',
        targetWeekStartDate: '2026-07-06',
        mode: 'swap',
      } as never);
      // target получил гостя, источник — местного брата
      expect(res.target.speakerName).toBe('Гость Будущий');
      expect(res.target.publicTalkId).toBe('talk-7');
      expect(res.source.publisherId).toBe('pub-local');
      expect(res.source.publicTalkId).toBe('talk-3');
      // оба помечены как изменённые после публикации
      expect(res.source.changedSincePublish).toBe(true);
      expect(res.target.changedSincePublish).toBe(true);
      expect(sync).toHaveBeenCalledWith(CONG, '2026-07-13');
      expect(sync).toHaveBeenCalledWith(CONG, '2026-07-06');
    });

    it('move fills the target and clears the source', async () => {
      const a = src();
      const b = tgt();
      mockSlots(a, b);
      const res = await service.swapPublicTalk(CONG, {
        eventType: 'weekend',
        sourceWeekStartDate: '2026-07-13',
        targetWeekStartDate: '2026-07-06',
        mode: 'move',
      } as never);
      expect(res.target.speakerName).toBe('Гость Будущий');
      expect(res.source.publisherId).toBeNull();
      expect(res.source.speakerName).toBeNull();
      expect(res.source.publicTalkId).toBeNull();
    });

    it('rejects identical weeks', async () => {
      await expect(
        service.swapPublicTalk(CONG, {
          eventType: 'weekend',
          sourceWeekStartDate: '2026-07-13',
          targetWeekStartDate: '2026-07-13',
          mode: 'swap',
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when a week has no public-talk slot', async () => {
      mockSlots(src(), null);
      await expect(
        service.swapPublicTalk(CONG, {
          eventType: 'weekend',
          sourceWeekStartDate: '2026-07-13',
          targetWeekStartDate: '2026-07-06',
          mode: 'swap',
        } as never),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
