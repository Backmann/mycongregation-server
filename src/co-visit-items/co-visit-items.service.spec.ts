import {
  CoVisitItemsService,
  toCoVisitItemView,
} from './co-visit-items.service';
import type { CoVisitItem } from '../entities/co-visit-item.entity';

function item(partial: Partial<CoVisitItem>): CoVisitItem {
  return {
    id: 'i1',
    congregationId: 'c1',
    specialEventId: 'e1',
    kind: 'field_service',
    forWife: false,
    itemDate: '2026-07-08',
    startTime: '10:00',
    placeKind: 'kingdom_hall',
    cartLocationId: null,
    placeText: null,
    assigneePublisherId: null,
    assigneeText: null,
    note: null,
    sortOrder: 0,
    ...partial,
  } as CoVisitItem;
}

describe('toCoVisitItemView', () => {
  it('resolves assignee "Last First" when a publisher is set', () => {
    const v = toCoVisitItemView(
      item({
        assigneePublisherId: 'p1',
        assignee: { firstName: 'Alex', lastName: 'Weichel' } as never,
      }),
      true,
    );
    expect(v.assigneeName).toBe('Weichel Alex');
    expect(v.assigneeText).toBeNull();
  });

  it('leaves assigneeName null and keeps free-text when no publisher', () => {
    const v = toCoVisitItemView(
      item({ assignee: null, assigneeText: 'Familie Müller' }),
      true,
    );
    expect(v.assigneeName).toBeNull();
    expect(v.assigneeText).toBe('Familie Müller');
  });

  it('surfaces cart location name when present', () => {
    const v = toCoVisitItemView(
      item({
        placeKind: 'cart_location',
        cartLocationId: 'l1',
        cartLocation: { name: 'Hauptbahnhof' } as never,
      }),
      true,
    );
    expect(v.cartLocationName).toBe('Hauptbahnhof');
  });

  it('exposes phone/address only when canViewPrivate', () => {
    const it = item({
      assigneePublisherId: 'p1',
      assignee: {
        firstName: 'Alex',
        lastName: 'Weichel',
        mobilePhone: '0157 1234',
        address: 'Musterstr. 1',
      } as never,
    });
    const shown = toCoVisitItemView(it, true);
    expect(shown.assigneePhone).toBe('0157 1234');
    expect(shown.assigneeAddress).toBe('Musterstr. 1');
    const hidden = toCoVisitItemView(it, false);
    expect(hidden.assigneePhone).toBeNull();
    expect(hidden.assigneeAddress).toBeNull();
  });
});

describe('CoVisitItemsService.mine', () => {
  const CONG = 'c1';
  const USER = { id: 'u1', role: 'publisher' } as any;
  const visit = {
    id: 'v1',
    title: 'Посещение РН',
    date: '2099-01-05',
    endDate: '2099-01-11',
  };

  function build(publisher: any, items: any[]) {
    const repo = { find: jest.fn(async () => items) } as any;
    const eventsRepo = {
      find: jest.fn(async () => [{ ...visit, type: 'circuit_overseer_visit' }]),
    } as any;
    const usersRepo = {} as any;
    const publishersRepo = { findOne: jest.fn(async () => publisher) } as any;
    const auxService = {
      isActiveAuxiliaryPioneer: jest.fn(async () => false),
    } as any;
    return new CoVisitItemsService(
      repo,
      eventsRepo,
      usersRepo,
      publishersRepo,
      auxService,
    );
  }
  const base = {
    congregationId: CONG,
    specialEventId: 'v1',
    itemDate: '2099-01-06',
    startTime: '09:30',
    placeKind: 'kingdom_hall',
    cartLocationId: null,
    cartLocation: null,
    placeText: 'Hall',
    assignee: null,
    assigneePublisherId: null,
    assigneeText: null,
    note: null,
    sortOrder: 0,
    forWife: false,
    withWife: false,
  };

  it("returns partner items with serviceWith and the person's OWN note", async () => {
    const items = [
      {
        ...base,
        id: 'co1',
        kind: 'field_service',
        assigneePublisherId: 'other',
        note: 'Повторные посещения',
      },
      {
        ...base,
        id: 'w1',
        kind: 'field_service',
        forWife: true,
        assigneePublisherId: 'p1',
        note: 'Изучения',
      },
    ];
    const svc = build(
      { id: 'p1', pioneerType: 'none', appointment: 'publisher' },
      items,
    );
    const out = await svc.mine(CONG, USER);
    expect(out).toHaveLength(1);
    expect(out[0].items).toHaveLength(1);
    expect(out[0].items[0].serviceWith).toBe('wife');
    expect(out[0].items[0].note).toBe('Изучения');
  });

  it('shows the pioneer meeting to all pioneers (regular/special/missionary)', async () => {
    const items = [{ ...base, id: 'pm', kind: 'pioneers' }];
    const reg = build(
      { id: 'p1', pioneerType: 'regular', appointment: 'publisher' },
      items,
    );
    expect((await reg.mine(CONG, USER))[0]?.items).toHaveLength(1);

    // Special pioneers and missionaries are pioneers too.
    const special = build(
      { id: 'p1', pioneerType: 'special', appointment: 'publisher' },
      items,
    );
    expect((await special.mine(CONG, USER))[0]?.items).toHaveLength(1);
    const missionary = build(
      { id: 'p1', pioneerType: 'missionary', appointment: 'publisher' },
      items,
    );
    expect((await missionary.mine(CONG, USER))[0]?.items).toHaveLength(1);

    const plain = build(
      {
        id: 'p1',
        pioneerType: 'none',
        appointment: 'publisher',
      },
      items,
    );
    expect(await plain.mine(CONG, USER)).toHaveLength(0);

    // Pioneer whose start date is in the future is not yet a pioneer.
    const future = build(
      {
        id: 'p1',
        pioneerType: 'regular',
        pioneerSince: '2999-01-01',
        appointment: 'publisher',
      },
      items,
    );
    expect(await future.mine(CONG, USER)).toHaveLength(0);
  });

  it('shows the pioneer meeting to an auxiliary pioneer serving this month', async () => {
    const items = [{ ...base, id: 'pm', kind: 'pioneers' }];
    // Publisher with no permanent pioneer type, but auxiliary this month.
    const repo = { find: jest.fn(async () => items) } as any;
    const eventsRepo = {
      find: jest.fn(async () => [{ ...visit, type: 'circuit_overseer_visit' }]),
    } as any;
    const publishersRepo = {
      findOne: jest.fn(async () => ({
        id: 'p1',
        pioneerType: 'none',
        appointment: 'publisher',
      })),
    } as any;
    const auxService = {
      isActiveAuxiliaryPioneer: jest.fn(async () => true),
    } as any;
    const svc = new CoVisitItemsService(
      repo,
      eventsRepo,
      {} as any,
      publishersRepo,
      auxService,
    );
    expect((await svc.mine(CONG, USER))[0]?.items).toHaveLength(1);
  });

  it('shows the elders meeting to elders and ministerial servants only', async () => {
    const items = [{ ...base, id: 'em', kind: 'elders' }];
    const ms = build(
      { id: 'p1', pioneerType: 'none', appointment: 'ministerial_servant' },
      items,
    );
    expect((await ms.mine(CONG, USER))[0]?.items).toHaveLength(1);
    const pub = build(
      { id: 'p1', pioneerType: 'none', appointment: 'publisher' },
      items,
    );
    expect(await pub.mine(CONG, USER)).toHaveLength(0);
  });

  it('returns nothing when the user has no linked publisher', async () => {
    const svc = build(null, [{ ...base, id: 'x', kind: 'lunch' }]);
    expect(await svc.mine(CONG, USER)).toHaveLength(0);
  });
});

describe('CoVisitItemsService.hostStats', () => {
  it('aggregates totals with past lastDate and future nextDate per kind', async () => {
    const rows = [
      { kind: 'lunch', itemDate: '2020-01-01', assigneePublisherId: 'p1' },
      { kind: 'lunch', itemDate: '2020-06-01', assigneePublisherId: 'p1' },
      { kind: 'lunch', itemDate: '2099-01-01', assigneePublisherId: 'p2' },
      { kind: 'lunch_box', itemDate: '2020-03-01', assigneePublisherId: 'p1' },
    ];
    const qb: any = {
      select: () => qb,
      where: () => qb,
      andWhere: () => qb,
      getMany: async () => rows,
    };
    const repo = { createQueryBuilder: () => qb } as any;
    const svc = new CoVisitItemsService(repo, {} as any, {} as any, {} as any);
    const out = await svc.hostStats('c1');
    const p1lunch = out.find(
      (s) => s.publisherId === 'p1' && s.kind === 'lunch',
    );
    expect(p1lunch).toMatchObject({
      total: 2,
      lastDate: '2020-06-01',
      nextDate: null,
    });
    const p2 = out.find((s) => s.publisherId === 'p2');
    expect(p2).toMatchObject({
      total: 1,
      lastDate: null,
      nextDate: '2099-01-01',
    });
    expect(out.find((s) => s.kind === 'lunch_box')?.total).toBe(1);
  });
});

describe('CoVisitItemsService.mine — accommodation host & legacy copies', () => {
  const CONG = 'c1';
  const USER = { id: 'u1', role: 'publisher' } as any;

  function build(visitExtra: any, publisher: any, items: any[]) {
    const repo = { find: jest.fn(async () => items) } as any;
    const eventsRepo = {
      find: jest.fn(async () => [
        {
          id: 'v1',
          title: 'Визит',
          date: '2099-01-05',
          endDate: '2099-01-11',
          type: 'circuit_overseer_visit',
          ...visitExtra,
        },
      ]),
    } as any;
    const publishersRepo = { findOne: jest.fn(async () => publisher) } as any;
    const auxService = {
      isActiveAuxiliaryPioneer: jest.fn(async () => false),
    } as any;
    return new CoVisitItemsService(
      repo,
      eventsRepo,
      {} as any,
      publishersRepo,
      auxService,
    );
  }

  it('gives the accommodation host a synthetic item', async () => {
    const svc = build(
      { coAccommodationPublisherId: 'p1' },
      { id: 'p1', pioneerType: 'none', appointment: 'publisher' },
      [],
    );
    const out = await svc.mine(CONG, USER);
    expect(out).toHaveLength(1);
    expect(out[0].items[0].kind).toBe('accommodation');
  });

  it('skips legacy wife copies of shared kinds (no duplicates)', async () => {
    const base = {
      congregationId: CONG,
      specialEventId: 'v1',
      itemDate: '2099-01-06',
      startTime: '12:15',
      placeKind: null,
      cartLocationId: null,
      cartLocation: null,
      placeText: null,
      assignee: null,
      assigneeText: null,
      note: null,
      sortOrder: 0,
      withWife: false,
    };
    const svc = build(
      {},
      { id: 'p1', pioneerType: 'none', appointment: 'publisher' },
      [
        {
          ...base,
          id: 'l1',
          kind: 'lunch',
          forWife: false,
          assigneePublisherId: 'p1',
        },
        {
          ...base,
          id: 'l2',
          kind: 'lunch',
          forWife: true,
          assigneePublisherId: 'p1',
        },
      ],
    );
    const out = await svc.mine(CONG, USER);
    expect(out[0].items).toHaveLength(1);
    expect(out[0].items[0].id).toBe('l1');
  });
});
