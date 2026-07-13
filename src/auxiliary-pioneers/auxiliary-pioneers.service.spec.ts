import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuxiliaryPioneersService } from './auxiliary-pioneers.service';
import { AuxiliaryPioneer } from '../entities/auxiliary-pioneer.entity';
import { Publisher } from '../entities/publisher.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { UserRole } from '../common/enums/user-role.enum';
import { PublisherAppointment } from '../common/enums/publisher-appointment.enum';

const CONG = 'cong-1';
const admin = { id: 'u-admin', role: UserRole.ADMIN } as never;
const plain = { id: 'u-plain', role: UserRole.PUBLISHER } as never;

describe('AuxiliaryPioneersService', () => {
  let service: AuxiliaryPioneersService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    remove: jest.Mock;
  };
  let publisherRepo: { find: jest.Mock; findOne: jest.Mock };
  let responsibilityRepo: { count: jest.Mock };
  let eventRepo: { find: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'new', ...v })),
      delete: jest.fn(),
      remove: jest.fn(async (v) => v),
    };
    publisherRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };
    responsibilityRepo = { count: jest.fn().mockResolvedValue(0) };
    eventRepo = { find: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuxiliaryPioneersService,
        { provide: getRepositoryToken(AuxiliaryPioneer), useValue: repo },
        { provide: getRepositoryToken(Publisher), useValue: publisherRepo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilityRepo,
        },
        { provide: getRepositoryToken(SpecialEvent), useValue: eventRepo },
      ],
    }).compile();
    service = moduleRef.get(AuxiliaryPioneersService);
  });

  describe('permissions', () => {
    it('admin can manage', async () => {
      await expect(
        service.assertCanManage(CONG, admin),
      ).resolves.toBeUndefined();
    });
    it('a plain publisher without responsibility is forbidden', async () => {
      responsibilityRepo.count.mockResolvedValue(0);
      await expect(service.assertCanManage(CONG, plain)).rejects.toThrow(
        ForbiddenException,
      );
    });
    it('a body coordinator / secretary / service overseer may manage', async () => {
      responsibilityRepo.count.mockResolvedValue(1);
      await expect(
        service.assertCanManage(CONG, plain),
      ).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    it('rejects an unbaptized publisher', async () => {
      publisherRepo.findOne.mockResolvedValue({
        id: 'p1',
        appointment: PublisherAppointment.UNBAPTIZED_PUBLISHER,
      });
      await expect(
        service.create(CONG, admin, {
          publisherId: 'p1',
          startMonth: '2026-03-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a student', async () => {
      publisherRepo.findOne.mockResolvedValue({
        id: 'p1',
        appointment: PublisherAppointment.STUDENT,
      });
      await expect(
        service.create(CONG, admin, {
          publisherId: 'p1',
          startMonth: '2026-03-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates an until-cancelled record (endMonth null)', async () => {
      publisherRepo.findOne.mockResolvedValue({
        id: 'p1',
        appointment: PublisherAppointment.PUBLISHER,
      });
      const saved = await service.create(CONG, admin, {
        publisherId: 'p1',
        startMonth: '2026-03-15',
        untilCancelled: true,
      });
      expect(saved.untilCancelled).toBe(true);
      expect(saved.endMonth).toBeNull();
      expect(saved.startMonth).toBe('2026-03-01');
    });

    it('normalizes months and rejects end before start', async () => {
      publisherRepo.findOne.mockResolvedValue({
        id: 'p1',
        appointment: PublisherAppointment.PUBLISHER,
      });
      await expect(
        service.create(CONG, admin, {
          publisherId: 'p1',
          startMonth: '2026-05-01',
          endMonth: '2026-03-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listForMonth', () => {
    it('returns active rows with the computed hour goal (April = 15)', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'a1',
          publisherId: 'p1',
          startMonth: '2026-03-01',
          endMonth: null,
          untilCancelled: true,
        },
        {
          id: 'a2',
          publisherId: 'p2',
          startMonth: '2026-01-01',
          endMonth: '2026-02-01',
          untilCancelled: false,
        },
      ]);
      publisherRepo.find.mockResolvedValue([{ id: 'p1', displayName: 'Anna' }]);
      const res = await service.listForMonth(CONG, '2026-04-10');
      expect(res.hourGoal).toBe(15); // April
      expect(res.rows).toHaveLength(1); // only the until-cancelled one is active
      expect(res.rows[0].publisherId).toBe('p1');
    });

    it('ordinary month with no events → 30h', async () => {
      repo.find.mockResolvedValue([]);
      const res = await service.listForMonth(CONG, '2026-07-01');
      expect(res.hourGoal).toBe(30);
    });
  });

  describe('update', () => {
    const existing = {
      id: 'a1',
      congregationId: CONG,
      startMonth: '2026-03-01',
      endMonth: '2026-05-01',
      untilCancelled: false,
    };
    it('changes the start month', async () => {
      repo.findOne.mockResolvedValue({ ...existing });
      const res = await service.update(CONG, admin, 'a1', {
        startMonth: '2024-01-15',
      });
      expect(res.startMonth).toBe('2024-01-01');
    });
    it('switching to until-cancelled clears the end month', async () => {
      repo.findOne.mockResolvedValue({ ...existing });
      const res = await service.update(CONG, admin, 'a1', {
        untilCancelled: true,
      });
      expect(res.untilCancelled).toBe(true);
      expect(res.endMonth).toBeNull();
    });
    it('rejects an end month before the start', async () => {
      repo.findOne.mockResolvedValue({ ...existing });
      await expect(
        service.update(CONG, admin, 'a1', { endMonth: '2026-01-01' }),
      ).rejects.toThrow(BadRequestException);
    });
    it('404 when the record is missing', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.update(CONG, admin, 'missing', { startMonth: '2026-03-01' }),
      ).rejects.toThrow(NotFoundException);
    });
    it('forbidden for a non-manager', async () => {
      responsibilityRepo.count.mockResolvedValue(0);
      await expect(
        service.update(CONG, plain, 'a1', { startMonth: '2026-03-01' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('journal', () => {
    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 15)); // July 2026
    });
    afterEach(() => jest.restoreAllMocks());

    it('classifies upcoming / serving / finished by the current month', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'up',
          publisherId: 'p-up',
          startMonth: '2026-08-01',
          endMonth: '2026-08-01',
          untilCancelled: false,
        }, // future → upcoming
        {
          id: 'now',
          publisherId: 'p-now',
          startMonth: '2026-03-01',
          endMonth: null,
          untilCancelled: true,
        }, // covers July → serving
        {
          id: 'past',
          publisherId: 'p-past',
          startMonth: '2026-01-01',
          endMonth: '2026-02-01',
          untilCancelled: false,
        }, // past → finished
      ]);
      publisherRepo.find.mockResolvedValue([
        { id: 'p-up', displayName: 'Up' },
        { id: 'p-now', displayName: 'Now' },
        { id: 'p-past', displayName: 'Past' },
      ]);
      const rows = await service.journal(CONG);
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.state]));
      expect(byId).toEqual({
        up: 'upcoming',
        now: 'serving',
        past: 'finished',
      });
      // Order: serving, then upcoming, then finished.
      expect(rows.map((r) => r.id)).toEqual(['now', 'up', 'past']);
    });

    it('a single future month is upcoming, not finished', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'aug',
          publisherId: 'p1',
          startMonth: '2026-08-01',
          endMonth: '2026-08-01',
          untilCancelled: false,
        },
      ]);
      publisherRepo.find.mockResolvedValue([{ id: 'p1', displayName: 'A' }]);
      const rows = await service.journal(CONG);
      expect(rows[0].state).toBe('upcoming');
    });
  });

  describe('stop', () => {
    it('sets endMonth and clears untilCancelled', async () => {
      repo.findOne.mockResolvedValue({
        id: 'a1',
        congregationId: CONG,
        startMonth: '2026-03-01',
        endMonth: null,
        untilCancelled: true,
      });
      const res = await service.stop(CONG, admin, 'a1', {
        endMonth: '2026-07-01',
      });
      expect(res.endMonth).toBe('2026-07-01');
      expect(res.untilCancelled).toBe(false);
    });

    it('404 when the record is missing', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.stop(CONG, admin, 'missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('isSelfActiveAuxiliaryPioneer', () => {
    it('false when the user has no publisher record', async () => {
      publisherRepo.findOne.mockResolvedValue(null);
      await expect(
        service.isSelfActiveAuxiliaryPioneer(CONG, plain, '2026-04-01'),
      ).resolves.toBe(false);
    });
    it('true when the resolved publisher is serving that month', async () => {
      publisherRepo.findOne.mockResolvedValue({ id: 'p-self' });
      repo.find.mockResolvedValue([
        { startMonth: '2026-03-01', endMonth: null, untilCancelled: true },
      ]);
      await expect(
        service.isSelfActiveAuxiliaryPioneer(CONG, plain, '2026-04-01'),
      ).resolves.toBe(true);
    });
  });

  describe('isActiveAuxiliaryPioneer', () => {
    it('true when a period covers the month', async () => {
      repo.find.mockResolvedValue([
        {
          startMonth: '2026-03-01',
          endMonth: null,
          untilCancelled: true,
        },
      ]);
      await expect(
        service.isActiveAuxiliaryPioneer(CONG, 'p1', '2026-09-01'),
      ).resolves.toBe(true);
    });
    it('false when no period covers the month', async () => {
      repo.find.mockResolvedValue([
        {
          startMonth: '2026-03-01',
          endMonth: '2026-04-01',
          untilCancelled: false,
        },
      ]);
      await expect(
        service.isActiveAuxiliaryPioneer(CONG, 'p1', '2026-09-01'),
      ).resolves.toBe(false);
    });
  });

  describe('closeActiveForPublisher', () => {
    it('ends an open until-cancelled period the month before the new pioneer month', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'a1',
          congregationId: CONG,
          publisherId: 'p1',
          startMonth: '2026-05-01',
          endMonth: null,
          untilCancelled: true,
        },
      ]);

      const closed = await service.closeActiveForPublisher(
        CONG,
        'p1',
        '2026-08-01',
      );

      expect(closed).toBe(1);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'a1',
          endMonth: '2026-07-01',
          untilCancelled: false,
        }),
      );
    });

    it('removes a period that starts on or after the new pioneer month', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'a2',
          congregationId: CONG,
          publisherId: 'p1',
          startMonth: '2026-08-01',
          endMonth: null,
          untilCancelled: true,
        },
      ]);

      const closed = await service.closeActiveForPublisher(
        CONG,
        'p1',
        '2026-08-01',
      );

      expect(closed).toBe(1);
      expect(repo.remove).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('leaves already-ended periods untouched', async () => {
      repo.find.mockResolvedValue([
        {
          id: 'a3',
          congregationId: CONG,
          publisherId: 'p1',
          startMonth: '2026-01-01',
          endMonth: '2026-03-01',
          untilCancelled: false,
        },
      ]);

      const closed = await service.closeActiveForPublisher(
        CONG,
        'p1',
        '2026-08-01',
      );

      expect(closed).toBe(0);
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });
});
