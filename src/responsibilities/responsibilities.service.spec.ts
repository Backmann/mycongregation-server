import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ResponsibilitiesService } from './responsibilities.service';
import { Responsibility } from '../entities/responsibility.entity';
import { User } from '../entities/user.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

describe('ResponsibilitiesService', () => {
  let service: ResponsibilitiesService;
  let responsibilitiesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let usersRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    responsibilitiesRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };
    usersRepo = { findOne: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResponsibilitiesService,
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilitiesRepo,
        },
        { provide: getRepositoryToken(User), useValue: usersRepo },
      ],
    }).compile();

    service = moduleRef.get(ResponsibilitiesService);
  });

  describe('assign', () => {
    it('creates a new responsibility when the type is not yet held', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'u1', congregationId: 't1' });
      responsibilitiesRepo.findOne.mockResolvedValue(null);
      responsibilitiesRepo.create.mockImplementation((x: unknown) => x);
      responsibilitiesRepo.save.mockImplementation((x: unknown) =>
        Promise.resolve({ id: 'r1', ...(x as object) }),
      );

      const result = await service.assign(
        't1',
        { type: ResponsibilityType.SECRETARY, userId: 'u1' },
        'admin1',
      );

      expect(responsibilitiesRepo.create).toHaveBeenCalledWith({
        congregationId: 't1',
        type: ResponsibilityType.SECRETARY,
        userId: 'u1',
        assignedBy: 'admin1',
      });
      expect(result).toMatchObject({ id: 'r1', userId: 'u1' });
    });

    it('is idempotent when the same person already holds the type', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'u1', congregationId: 't1' });
      const existing = {
        id: 'r-existing',
        congregationId: 't1',
        type: ResponsibilityType.SECRETARY,
        userId: 'u1',
        assignedBy: 'admin0',
        assignedAt: new Date('2026-01-01'),
      };
      responsibilitiesRepo.findOne.mockResolvedValue(existing);

      const result = await service.assign(
        't1',
        { type: ResponsibilityType.SECRETARY, userId: 'u1' },
        'admin1',
      );

      expect(responsibilitiesRepo.create).not.toHaveBeenCalled();
      expect(responsibilitiesRepo.save).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('adds a second holder for an already-held type', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'u2', congregationId: 't1' });
      responsibilitiesRepo.findOne.mockResolvedValue(null);
      responsibilitiesRepo.create.mockReturnValue({ id: 'r2', userId: 'u2' });
      responsibilitiesRepo.save.mockImplementation((x: unknown) =>
        Promise.resolve(x),
      );

      const result = await service.assign(
        't1',
        { type: ResponsibilityType.SECRETARY, userId: 'u2' },
        'admin1',
      );

      expect(responsibilitiesRepo.create).toHaveBeenCalledWith({
        congregationId: 't1',
        type: ResponsibilityType.SECRETARY,
        userId: 'u2',
        assignedBy: 'admin1',
      });
      expect(result).toMatchObject({ userId: 'u2' });
    });

    it('rejects assignment to a user outside the congregation', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assign(
          't1',
          { type: ResponsibilityType.SECRETARY, userId: 'ghost' },
          'admin1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(responsibilitiesRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('removes an existing responsibility', async () => {
      const existing = {
        id: 'r1',
        type: ResponsibilityType.CLEANING_COORDINATOR,
      };
      responsibilitiesRepo.findOne.mockResolvedValue(existing);

      await service.revoke('t1', ResponsibilityType.CLEANING_COORDINATOR, 'u1');

      expect(responsibilitiesRepo.remove).toHaveBeenCalledWith(existing);
    });

    it('throws NotFound when the responsibility is not assigned', async () => {
      responsibilitiesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.revoke('t1', ResponsibilityType.CLEANING_COORDINATOR, 'u1'),
      ).rejects.toThrow(NotFoundException);
      expect(responsibilitiesRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns responsibilities scoped to the congregation', async () => {
      const rows = [{ id: 'r1' }, { id: 'r2' }];
      responsibilitiesRepo.find.mockResolvedValue(rows);

      const result = await service.findAll('t1');

      expect(responsibilitiesRepo.find).toHaveBeenCalledWith({
        where: { congregationId: 't1' },
        order: { type: 'ASC' },
      });
      expect(result).toBe(rows);
    });
  });
});
