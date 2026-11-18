import { ConflictException, ForbiddenException } from '@nestjs/common';
import { asVisited, strayWifeRows, wifeComes } from './co-visit-wife';
import {
  CoVisitItemsService,
  forReader,
  toCoVisitItemView,
} from './co-visit-items.service';
import { clockStub } from '../common/testing/clock-stub';

/**
 * Two rules of 18 November 2026, Lionel:
 * - the overseer's wife is part of the week only when she comes;
 * - shepherding calls are seen in full, and planned, by elders only.
 */
describe('the wife is part of the week only when she comes', () => {
  const rows = [
    { id: 'co', forWife: false, withWife: false },
    { id: 'her', forWife: true, withWife: false },
    { id: 'joint', forWife: false, withWife: true },
  ];

  it('the visit says so, not her name', () => {
    expect(wifeComes({ coWifeComes: true })).toBe(true);
    expect(wifeComes({ coWifeComes: false })).toBe(false);
    expect(wifeComes({})).toBe(false);
  });

  it('when she comes, the rows stay as they are — the very same objects', () => {
    expect(asVisited(rows, true)).toBe(rows);
  });

  it('when she does not, her rows go and «together» is his outing', () => {
    expect(asVisited(rows, false)).toEqual([
      { id: 'co', forWife: false, withWife: false },
      { id: 'joint', forWife: false, withWife: false },
    ]);
    // Nothing read is changed in place.
    expect(rows[2].withWife).toBe(true);
  });

  it('names exactly what the planner must clear', () => {
    expect(strayWifeRows(rows, false)).toEqual({
      removed: ['her'],
      unjoined: ['joint'],
    });
    expect(strayWifeRows(rows, true)).toEqual({ removed: [], unjoined: [] });
  });
});

describe('a shepherding call as a planner who is not an elder sees it', () => {
  const call = toCoVisitItemView(
    {
      id: 'p1',
      kind: 'pastoral',
      forWife: false,
      withWife: false,
      itemDate: '2094-02-24',
      startTime: '16:00',
      placeKind: 'custom',
      cartLocationId: null,
      cartLocation: null,
      placeText: 'Street 1',
      assigneePublisherId: 'elder-1',
      assignee: {
        firstName: 'Борис',
        lastName: 'Лаптев',
        mobilePhone: '0151',
        address: 'Street 2',
      },
      assigneeText: 'brother',
      note: 'the family',
      sortOrder: 0,
    } as never,
    true,
  );

  it('keeps when, and nothing of who or to whom', () => {
    const v = forReader(call, false);
    expect(v).toMatchObject({
      kind: 'pastoral',
      itemDate: '2094-02-24',
      startTime: '16:00',
      restricted: true,
    });
    for (const k of [
      'placeText',
      'assigneePublisherId',
      'assigneeName',
      'assigneePhone',
      'assigneeAddress',
      'assigneeText',
      'note',
    ] as const)
      expect(v[k]).toBeNull();
  });

  it('an elder sees it whole, and other kinds are untouched', () => {
    expect(forReader(call, true)).toBe(call);
    const lunch = { ...call, kind: 'lunch' };
    expect(forReader(lunch, false)).toBe(lunch);
  });
});

describe('who may write a shepherding call, and her rows', () => {
  function build(opts: { appointment?: string; wifeComes: boolean }) {
    const item = {
      id: 'it-1',
      congregationId: 'c',
      specialEventId: 'ev-1',
      kind: 'pastoral',
      itemDate: '2099-12-30',
      deletedAt: new Date(),
    } as any;
    const repo = {
      findOne: jest.fn(async () => item),
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => ({ ...x, id: 'new-1' })),
      softDelete: jest.fn(async () => ({ affected: 1 })),
      restore: jest.fn(async () => ({ affected: 1 })),
    } as any;
    const eventsRepo = {
      findOne: jest.fn(async () => ({
        id: 'ev-1',
        date: '2099-12-29',
        endDate: '2099-12-31',
        coWifeComes: opts.wifeComes,
      })),
    } as any;
    const publishersRepo = {
      findOne: jest.fn(async () =>
        opts.appointment ? { appointment: opts.appointment } : null,
      ),
    } as any;
    const svc = new CoVisitItemsService(
      repo,
      eventsRepo,
      { findOne: jest.fn(async () => null) } as any,
      publishersRepo,
      {} as any,
      { logEvent: jest.fn() } as never,
      clockStub(),
      { count: jest.fn(async () => 1) } as any,
    );
    return { svc, repo };
  }
  const servant = { id: 'u', role: 'ministerial_servant' } as any;
  const admin = { id: 'u', role: 'admin' } as any;
  const elderRole = { id: 'u', role: 'elder' } as any;
  const add = (kind: string, extra: object = {}) =>
    ({
      specialEventId: 'ev-1',
      kind,
      itemDate: '2099-12-30',
      ...extra,
    }) as any;

  it('an assistant who is not an elder may not add, change, remove or restore one', async () => {
    for (const call of [
      (s: CoVisitItemsService) => s.create('c', add('pastoral'), servant),
      (s: CoVisitItemsService) => s.update('c', 'it-1', {}, servant),
      (s: CoVisitItemsService) =>
        s.update('c', 'it-1', { kind: 'pastoral' } as any, servant),
      (s: CoVisitItemsService) => s.remove('c', 'it-1', servant),
      (s: CoVisitItemsService) => s.restore('c', 'it-1', servant),
    ]) {
      const { svc, repo } = build({
        appointment: 'ministerial_servant',
        wifeComes: true,
      });
      await expect(call(svc)).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.softDelete).not.toHaveBeenCalled();
      expect(repo.restore).not.toHaveBeenCalled();
    }
  });

  it('an administrator is judged by his card, like the S-61 folder', async () => {
    const notElder = build({ wifeComes: true });
    await expect(
      notElder.svc.create('c', add('pastoral'), admin),
    ).rejects.toThrow(ForbiddenException);
    const elderCard = build({ appointment: 'elder', wifeComes: true });
    await expect(
      elderCard.svc.create('c', add('pastoral'), admin),
    ).resolves.toBeDefined();
  });

  it('an elder may, and anyone may write the other kinds', async () => {
    await expect(
      build({ wifeComes: true }).svc.create('c', add('pastoral'), elderRole),
    ).resolves.toBeDefined();
    await expect(
      build({ appointment: 'ministerial_servant', wifeComes: true }).svc.create(
        'c',
        add('lunch'),
        servant,
      ),
    ).resolves.toBeDefined();
  });

  it('no outing of hers, and no «together», on a visit she does not come to', async () => {
    for (const extra of [{ forWife: true }, { withWife: true }]) {
      const { svc, repo } = build({ wifeComes: false });
      await expect(
        svc.create('c', add('field_service', extra), elderRole),
      ).rejects.toThrow(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    }
    const { svc } = build({ wifeComes: false });
    await expect(
      svc.update('c', 'it-1', { withWife: true } as any, elderRole),
    ).rejects.toThrow(ConflictException);
    // Taking it away is always allowed.
    await expect(
      svc.update('c', 'it-1', { withWife: false } as any, elderRole),
    ).resolves.toBeDefined();
  });

  it('when she comes, both are allowed', async () => {
    await expect(
      build({ wifeComes: true }).svc.create(
        'c',
        add('field_service', { forWife: true }),
        elderRole,
      ),
    ).resolves.toBeDefined();
  });
});
