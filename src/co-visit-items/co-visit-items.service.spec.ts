import { toCoVisitItemView } from './co-visit-items.service';
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
