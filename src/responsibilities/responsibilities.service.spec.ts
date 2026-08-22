import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ResponsibilitiesService } from './responsibilities.service';
import { Responsibility } from '../entities/responsibility.entity';
import { User } from '../entities/user.entity';
import { Publisher } from '../entities/publisher.entity';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { AuditLogService } from '../audit-log/audit-log.service';

describe('ResponsibilitiesService', () => {
  let service: ResponsibilitiesService;
  let responsibilitiesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let usersRepo: { findOne: jest.Mock; find: jest.Mock };

  beforeEach(async () => {
    responsibilitiesRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };
    usersRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResponsibilitiesService,
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilitiesRepo,
        },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        {
          provide: getRepositoryToken(Publisher),
          // Names are resolved for the screen; assignment does not read them.
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: AuditLogService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logRawUpdate: jest.fn(),
            logEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ResponsibilitiesService);
  });

  describe('assign', () => {
    it('creates a new responsibility when the type is not yet held', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'u1', congregationId: 't1' });
      responsibilitiesRepo.findOne.mockResolvedValue(null);
      responsibilitiesRepo.find.mockResolvedValue([]);
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

    it('REPLACES the brother who held it, rather than standing beside him', async () => {
      // There is one secretary. The old code added a second holder and told
      // nobody — half the screen could end up with two men responsible for one
      // thing, and the comment above it promised the opposite.
      usersRepo.findOne.mockResolvedValue({ id: 'u2', congregationId: 't1' });
      responsibilitiesRepo.findOne.mockResolvedValue(null);
      responsibilitiesRepo.find.mockResolvedValue([
        { id: 'r1', userId: 'u1', type: ResponsibilityType.SECRETARY },
      ]);
      responsibilitiesRepo.create.mockReturnValue({ id: 'r2', userId: 'u2' });
      responsibilitiesRepo.save.mockImplementation((x: unknown) =>
        Promise.resolve(x),
      );

      const result = await service.assign(
        't1',
        { type: ResponsibilityType.SECRETARY, userId: 'u2' },
        'admin1',
      );

      expect(responsibilitiesRepo.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', userId: 'u1' }),
      );
      expect(result).toMatchObject({ userId: 'u2' });
    });

    it('journals the man who stepped down, not only the one who took over', async () => {
      // A privilege changing hands is exactly what a journal is for; a silent
      // swap would leave «почему я больше не секретарь» unanswerable.
      usersRepo.findOne.mockResolvedValue({ id: 'u2', congregationId: 't1' });
      responsibilitiesRepo.findOne.mockResolvedValue(null);
      responsibilitiesRepo.find.mockResolvedValue([
        { id: 'r1', userId: 'u1', type: ResponsibilityType.SECRETARY },
      ]);
      responsibilitiesRepo.create.mockReturnValue({ id: 'r2', userId: 'u2' });
      responsibilitiesRepo.save.mockImplementation((x: unknown) =>
        Promise.resolve(x),
      );

      await service.assign(
        't1',
        { type: ResponsibilityType.SECRETARY, userId: 'u2' },
        'admin1',
      );

      const audit = (
        service as unknown as { auditLog: { logEvent: jest.Mock } }
      ).auditLog;
      expect(audit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', subjectId: 'u1' }),
      );
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

  it('lets the study conductor keep SEVERAL assistants', async () => {
    // The one duty here held by more than one brother: he stands in when the
    // conductor is away, and a congregation keeps a couple of men able to.
    // Replacing the first would quietly undo an appointment nobody revoked.
    usersRepo.findOne.mockResolvedValue({ id: 'u2', congregationId: 't1' });
    responsibilitiesRepo.findOne.mockResolvedValue(null);
    responsibilitiesRepo.find.mockResolvedValue([
      {
        id: 'r1',
        userId: 'u1',
        type: ResponsibilityType.WT_STUDY_CONDUCTOR_BACKUP,
      },
    ]);
    responsibilitiesRepo.create.mockImplementation((x: unknown) => x);
    responsibilitiesRepo.save.mockImplementation((x: unknown) =>
      Promise.resolve({ id: 'r2', ...(x as object) }),
    );

    await service.assign(
      't1',
      {
        type: ResponsibilityType.WT_STUDY_CONDUCTOR_BACKUP,
        userId: 'u2',
      },
      'admin1',
    );

    expect(responsibilitiesRepo.remove).not.toHaveBeenCalled();
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
    it('returns responsibilities scoped to the congregation, in a stable order', async () => {
      // Ordered by assignment as well as type: rows returned in whatever order
      // the database felt like swap places between reloads and read as a
      // change nobody made.
      responsibilitiesRepo.find.mockResolvedValue([
        { id: 'r1', userId: 'u1', assignedBy: null },
      ]);

      const result = await service.findAll('t1');

      expect(responsibilitiesRepo.find).toHaveBeenCalledWith({
        where: { congregationId: 't1' },
        order: { type: 'ASC', assignedAt: 'ASC' },
      });
      expect(result).toHaveLength(1);
    });

    it('carries the names, because ids and e-mails explain nothing', async () => {
      // The screen was a column of twelve addresses. The card's name is how
      // the brothers know each other.
      responsibilitiesRepo.find.mockResolvedValue([
        { id: 'r1', userId: 'u1', assignedBy: 'u2' },
      ]);
      (
        service as unknown as { publishersRepo: { find: jest.Mock } }
      ).publishersRepo.find.mockResolvedValue([
        { userId: 'u1', firstName: 'Рудольф', lastName: 'Кипко' },
        { userId: 'u2', firstName: 'Лионель', lastName: 'Бакманн' },
      ]);

      const [row] = await service.findAll('t1');

      expect(row.holderName).toBe('Кипко Рудольф');
      expect(row.assignedByName).toBe('Бакманн Лионель');
    });

    it('falls back to the login name for an account with no card', async () => {
      responsibilitiesRepo.find.mockResolvedValue([
        { id: 'r1', userId: 'u1', assignedBy: null },
      ]);
      (
        service as unknown as { publishersRepo: { find: jest.Mock } }
      ).publishersRepo.find.mockResolvedValue([]);
      usersRepo.find.mockResolvedValue([
        { id: 'u1', loginName: 'backmann.lionel' },
      ]);

      const [row] = await service.findAll('t1');

      expect(row.holderName).toBe('backmann.lionel');
    });
  });
});
