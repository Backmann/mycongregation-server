import { NotFoundException } from '@nestjs/common';
import { FieldServiceMeetingsService } from './field-service-meetings.service';

/** Minimal chainable query-builder mock. */
function makeQb(result: unknown[]) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['where', 'andWhere', 'orderBy', 'addOrderBy']) {
    qb[m] = jest.fn(() => qb);
  }
  qb.getMany = jest.fn(async () => result);
  return qb;
}

const CONG = '11111111-1111-1111-1111-111111111111';

describe('FieldServiceMeetingsService', () => {
  it('list() scopes by congregation, filters by week, orders by day then time', async () => {
    const qb = makeQb([{ id: 'm1' }]);
    const repo = { createQueryBuilder: jest.fn(() => qb) } as any;
    const svc = new FieldServiceMeetingsService(repo);

    const out = await svc.list(CONG, { weekStart: '2026-05-18' });

    expect(repo.createQueryBuilder).toHaveBeenCalledWith('m');
    expect(qb.where).toHaveBeenCalledWith(
      'm.congregationId = :congregationId',
      {
        congregationId: CONG,
      },
    );
    expect(qb.andWhere).toHaveBeenCalledWith('m.weekStartDate = :weekStart', {
      weekStart: '2026-05-18',
    });
    expect(qb.addOrderBy).toHaveBeenCalledWith('m.dayOfWeek', 'ASC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('m.startTime', 'ASC');
    expect(out).toEqual([{ id: 'm1' }]);
  });

  it('list() omits the week filter when weekStart is absent', async () => {
    const qb = makeQb([]);
    const repo = { createQueryBuilder: jest.fn(() => qb) } as any;
    const svc = new FieldServiceMeetingsService(repo);

    await svc.list(CONG, {});

    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('create() defaults optional fields to null and stamps the tenant id', async () => {
    const repo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: Record<string, unknown>) => ({
        ...v,
        id: 'new',
      })),
    } as any;
    const svc = new FieldServiceMeetingsService(repo);

    const out = await svc.create(CONG, {
      weekStartDate: '2026-05-18',
      dayOfWeek: 2,
      startTime: '10:00',
      address: 'City park, main gate',
    } as any);

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        congregationId: CONG,
        conductorPublisherId: null,
        topic: null,
        sourceUrl: null,
      }),
    );
    expect(out.id).toBe('new');
  });

  it('update() throws NotFound when the row is missing for this tenant', async () => {
    const repo = { findOne: jest.fn(async () => null) } as any;
    const svc = new FieldServiceMeetingsService(repo);

    await expect(
      svc.update(CONG, 'missing', { startTime: '11:00' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'missing', congregationId: CONG },
    });
  });

  it('update() applies only the provided fields and can clear topic', async () => {
    const row = {
      id: 'm1',
      startTime: '10:00',
      address: 'A',
      topic: 'old',
    } as any;
    const repo = {
      findOne: jest.fn(async () => row),
      save: jest.fn(async (v: unknown) => v),
    } as any;
    const svc = new FieldServiceMeetingsService(repo);

    const out = await svc.update(CONG, 'm1', {
      startTime: '11:30',
      topic: null,
    } as any);

    expect(out.startTime).toBe('11:30');
    expect(out.topic).toBeNull();
    expect(out.address).toBe('A');
  });

  it('remove() throws NotFound when nothing was deleted', async () => {
    const repo = { delete: jest.fn(async () => ({ affected: 0 })) } as any;
    const svc = new FieldServiceMeetingsService(repo);

    await expect(svc.remove(CONG, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.delete).toHaveBeenCalledWith({
      id: 'missing',
      congregationId: CONG,
    });
  });
});
