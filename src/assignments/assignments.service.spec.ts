import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { Assignment } from '../entities/assignment.entity';
import { Responsibility } from '../entities/responsibility.entity';
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
  ]) {
    qb[m] = jest.fn().mockReturnThis();
  }
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
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
  let repo: { createQueryBuilder: jest.Mock; findOne: jest.Mock };
  let responsibilitiesRepo: { count: jest.Mock };
  let qb: ReturnType<typeof makeQb>;

  beforeEach(async () => {
    qb = makeQb();
    repo = {
      createQueryBuilder: jest.fn(() => qb),
      findOne: jest.fn(),
    };
    responsibilitiesRepo = { count: jest.fn().mockResolvedValue(0) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: getRepositoryToken(Assignment), useValue: repo },
        {
          provide: getRepositoryToken(Responsibility),
          useValue: responsibilitiesRepo,
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
});
