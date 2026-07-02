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
    return new CoVisitItemsService(repo, eventsRepo, usersRepo, publishersRepo);
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

  it('returns partner items with serviceWith and inherits the note for a wife pair', async () => {
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
    expect(out[0].items[0].note).toBe('Повторные посещения');
  });

  it('shows the pioneer meeting only to regular pioneers', async () => {
    const items = [{ ...base, id: 'pm', kind: 'pioneers' }];
    const reg = build(
      { id: 'p1', pioneerType: 'regular', appointment: 'publisher' },
      items,
    );
    expect((await reg.mine(CONG, USER))[0]?.items).toHaveLength(1);
    const aux = build(
      {
        id: 'p1',
        pioneerType: 'auxiliary_until_cancelled',
        appointment: 'publisher',
      },
      items,
    );
    expect(await aux.mine(CONG, USER)).toHaveLength(0);
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
