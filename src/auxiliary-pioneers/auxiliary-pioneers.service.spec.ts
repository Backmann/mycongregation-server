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
});
