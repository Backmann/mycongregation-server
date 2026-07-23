import { ForbiddenException } from '@nestjs/common';
import { AbsencesService } from './absences.service';

const auditMock = {
  logCreate: jest.fn(),
  logUpdate: jest.fn(),
  logEvent: jest.fn(),
} as any;

const TENANT = 'cong-1';
const elder = {
  id: 'u-elder',
  role: 'elder',
  congregationId: TENANT,
} as any;
const member = {
  id: 'u-member',
  role: 'publisher',
  congregationId: TENANT,
} as any;

function makeSvc(over: Partial<Record<string, any>> = {}) {
  const rows: any[] = over.rows ?? [];
  const qb: any = {
    leftJoin: jest.fn(() => qb),
    leftJoinAndSelect: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    select: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(function (this: any) {
      return qb;
    }),
    withDeleted: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    getMany: jest.fn(async () => rows),
    getOne: jest.fn(async () => over.one ?? null),
  };
  const repo = {
    createQueryBuilder: jest.fn(() => qb),
    restore: jest.fn(),
  } as any;
  const svc = new AbsencesService(
    repo,
    over.publishersRepo ??
      ({ findOne: jest.fn(async () => ({ id: 'pub-me' })) } as any),
    over.responsibilitiesRepo ?? ({ count: jest.fn(async () => 0) } as any),
    auditMock,
  );
  return { svc, qb };
}

describe('AbsencesService reads — scoping', () => {
  it('restricts a regular publisher to their own absences', async () => {
    const { svc, qb } = makeSvc();
    await svc.findAll(TENANT, {} as any, member);
    expect(qb.andWhere).toHaveBeenCalledWith('a.publisher_id = :own', {
      own: 'pub-me',
    });
  });

  it('returns empty for an unlinked regular user', async () => {
    const { svc, qb } = makeSvc({
      publishersRepo: { findOne: jest.fn(async () => null) },
    });
    const res = await svc.findAll(TENANT, {} as any, member);
    expect(res).toEqual([]);
    expect(qb.getMany).not.toHaveBeenCalled();
  });

  it('lets an elder see everything (no own-filter)', async () => {
    const { svc, qb } = makeSvc();
    await svc.findAll(TENANT, {} as any, elder);
    expect(qb.andWhere).not.toHaveBeenCalledWith(
      'a.publisher_id = :own',
      expect.anything(),
    );
  });

  it('lets a responsibility holder see everything', async () => {
    const { svc, qb } = makeSvc({
      responsibilitiesRepo: { count: jest.fn(async () => 1) },
    });
    await svc.findAll(TENANT, {} as any, member);
    expect(qb.andWhere).not.toHaveBeenCalledWith(
      'a.publisher_id = :own',
      expect.anything(),
    );
  });

  it("findOne forbids reading someone else's absence for a regular user", async () => {
    const { svc } = makeSvc({
      one: { id: 'a1', publisherId: 'pub-OTHER' },
    });
    await expect(svc.findOne(TENANT, 'a1', member)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('findOne allows own absence for a regular user', async () => {
    const { svc } = makeSvc({
      one: { id: 'a1', publisherId: 'pub-me' },
    });
    const res = await svc.findOne(TENANT, 'a1', member);
    expect(res.id).toBe('a1');
  });
});
