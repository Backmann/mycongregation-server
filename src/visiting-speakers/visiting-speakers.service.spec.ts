import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VisitingSpeakersService } from './visiting-speakers.service';
import { VisitingSpeaker } from '../entities/visiting-speaker.entity';
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

describe('VisitingSpeakersService', () => {
  let service: VisitingSpeakersService;
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
      save: jest.fn((x) => Promise.resolve({ id: 'spk-1', ...x })),
      softDelete: jest.fn().mockResolvedValue({}),
    };
    responsibilityRepo = { count: jest.fn().mockResolvedValue(0) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VisitingSpeakersService,
        { provide: getRepositoryToken(VisitingSpeaker), useValue: repo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilityRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(VisitingSpeakersService);
  });

  it('lets a coordinator create a speaker with a repertoire', async () => {
    responsibilityRepo.count.mockResolvedValue(1);
    const result = await service.create(
      TENANT,
      { firstName: 'Pavel', lastName: 'Petrov', talkNumbers: [12, 45] },
      user(),
    );
    expect(repo.save).toHaveBeenCalled();
    expect(result).toMatchObject({
      firstName: 'Pavel',
      talkNumbers: [12, 45],
      congregationId: TENANT,
    });
  });

  it('forbids a regular publisher from creating', async () => {
    responsibilityRepo.count.mockResolvedValue(0);
    await expect(
      service.create(TENANT, { firstName: 'Nope' }, user()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('lists speakers with their home congregation', async () => {
    await service.findAll(TENANT);
    expect(repo.find).toHaveBeenCalledWith({
      where: { congregationId: TENANT },
      relations: { externalCongregation: true },
      order: { lastName: 'ASC', firstName: 'ASC' },
    });
  });

  it('throws when a speaker is not found', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne(TENANT, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('soft-deletes on remove (as admin)', async () => {
    repo.findOne.mockResolvedValue({ id: 'spk-1', congregationId: TENANT });
    await service.remove(TENANT, 'spk-1', user({ role: UserRole.ADMIN }));
    expect(repo.softDelete).toHaveBeenCalledWith('spk-1');
  });
});
