import { ForbiddenException } from '@nestjs/common';
import { AbsencesService } from './absences.service';
import { clockStub } from '../common/testing/clock-stub';

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
    clockStub(over.timezone ?? 'Europe/Berlin'),
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

  it('cuts off the list by the congregation\u2019s own date, not the server\u2019s', async () => {
    // 22:30 UTC on 3 August: already the 4th in Berlin, still the 3rd in
    // Chicago. An absence that ended on the 3rd is over for one congregation
    // and still current for the other, and the whole point of reading the
    // timezone from the congregation is that each gets its own answer.
    jest.useFakeTimers({ now: Date.parse('2026-08-03T22:30:00Z') });
    try {
      const berlin = makeSvc({ timezone: 'Europe/Berlin' });
      await berlin.svc.findAll(TENANT, {} as any, elder);
      expect(berlin.qb.andWhere).toHaveBeenCalledWith(
        'COALESCE(a.end_date, a.start_date) >= :today',
        { today: '2026-08-04' },
      );

      const chicago = makeSvc({ timezone: 'America/Chicago' });
      await chicago.svc.findAll(TENANT, {} as any, elder);
      expect(chicago.qb.andWhere).toHaveBeenCalledWith(
        'COALESCE(a.end_date, a.start_date) >= :today',
        { today: '2026-08-03' },
      );
    } finally {
      jest.useRealTimers();
    }
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

  /**
   * Заметка поездки называет чужое собрание и номер речи. Отсутствие видеть
   * нужно многим, причину — нет.
   */
  describe('причина поездки', () => {
    const tripRow = {
      id: 'a-1',
      publisherId: 'pub-other',
      talkExchangeId: 'tx-1',
      note: '№42 · Unna-Russisch',
    };

    it('скрыта от того, кто просто держит ответственность', async () => {
      // Ответственный за уборку знает, что брата не будет, и этого довольно.
      const { svc } = makeSvc({
        rows: [tripRow],
        responsibilitiesRepo: {
          count: jest.fn(async (q: any) => (q?.where?.type ? 0 : 1)),
        },
      });

      const out = await svc.findAll(TENANT, {} as any, member);

      expect(out[0].note).toBeNull();
      // Само отсутствие остаётся: планирующему оно нужно.
      expect(out[0].id).toBe('a-1');
    });

    it('видна координатору речей', async () => {
      const { svc } = makeSvc({
        rows: [tripRow],
        responsibilitiesRepo: { count: jest.fn(async () => 1) },
      });

      const out = await svc.findAll(TENANT, {} as any, member);

      expect(out[0].note).toBe('№42 · Unna-Russisch');
    });

    it('видна старейшине-администратору', async () => {
      const admin = { id: 'u-a', role: 'admin', congregationId: TENANT } as any;
      const { svc } = makeSvc({ rows: [tripRow] });

      const out = await svc.findAll(TENANT, {} as any, admin);

      expect(out[0].note).toBe('№42 · Unna-Russisch');
    });

    it('своя заметка остаётся своей', async () => {
      // Правило про ЧУЖИЕ отсутствия: от самого брата скрывать нечего.
      const { svc } = makeSvc({
        rows: [{ ...tripRow, publisherId: 'pub-me' }],
        responsibilitiesRepo: {
          count: jest.fn(async (q: any) => (q?.where?.type ? 0 : 1)),
        },
      });

      const out = await svc.findAll(TENANT, {} as any, member);

      expect(out[0].note).toBe('№42 · Unna-Russisch');
    });

    it('обычное отсутствие не трогается', async () => {
      const { svc } = makeSvc({
        rows: [{ id: 'a-2', publisherId: 'pub-other', note: 'в отпуске' }],
        responsibilitiesRepo: {
          count: jest.fn(async (q: any) => (q?.where?.type ? 0 : 1)),
        },
      });

      const out = await svc.findAll(TENANT, {} as any, member);

      expect(out[0].note).toBe('в отпуске');
    });
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
