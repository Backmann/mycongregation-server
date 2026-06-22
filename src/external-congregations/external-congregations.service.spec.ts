import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExternalCongregationsService } from './external-congregations.service';
import { ExternalCongregation } from '../entities/external-congregation.entity';
import { Responsibility } from '../entities/responsibility.entity';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

const TENANT = 'cong-1';

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'me@example.org',
    role: UserRole.PUBLISHER,
    congregationId: TENANT,
    uiLanguage: 'en',
    ...overrides,
  };
}

describe('ExternalCongregationsService', () => {
  let service: ExternalCongregationsService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let responsibilityRepo: { count: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'ext-1', ...x })),
      softDelete: jest.fn().mockResolvedValue({}),
    };
    responsibilityRepo = { count: jest.fn().mockResolvedValue(0) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExternalCongregationsService,
        { provide: getRepositoryToken(ExternalCongregation), useValue: repo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilityRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(ExternalCongregationsService);
  });

  it('lets an admin create a congregation', async () => {
    const result = await service.create(
      TENANT,
      { name: 'Ahlen Mitte' },
      user({ role: UserRole.ADMIN }),
    );
    expect(repo.save).toHaveBeenCalled();
    expect(result).toMatchObject({
      name: 'Ahlen Mitte',
      congregationId: TENANT,
    });
    // admin shortcut: no responsibility lookup needed
    expect(responsibilityRepo.count).not.toHaveBeenCalled();
  });

  it('lets a public talk coordinator create a congregation', async () => {
    responsibilityRepo.count.mockResolvedValue(1);
    await expect(
      service.create(TENANT, { name: 'Hamm Süd' }, user()),
    ).resolves.toMatchObject({ name: 'Hamm Süd' });
  });

  it('forbids a regular publisher from creating', async () => {
    responsibilityRepo.count.mockResolvedValue(0);
    await expect(
      service.create(TENANT, { name: 'Nope' }, user()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('lists congregations for the tenant ordered by name', async () => {
    await service.findAll(TENANT);
    expect(repo.find).toHaveBeenCalledWith({
      where: { congregationId: TENANT },
      order: { name: 'ASC' },
    });
  });

  it('throws when a congregation is not found', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne(TENANT, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('soft-deletes on remove (as admin)', async () => {
    repo.findOne.mockResolvedValue({ id: 'ext-1', congregationId: TENANT });
    await service.remove(TENANT, 'ext-1', user({ role: UserRole.ADMIN }));
    expect(repo.softDelete).toHaveBeenCalledWith('ext-1');
  });
});
