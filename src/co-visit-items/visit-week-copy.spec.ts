import {
  daysOf,
  isoWeekday,
  templateFrom,
  type TemplateSource,
} from './visit-week-copy';

const src = (o: Partial<TemplateSource>): TemplateSource => ({
  kind: 'field_service',
  forWife: false,
  withWife: false,
  itemDate: '2026-08-05',
  startTime: '10:00:00',
  placeKind: 'kingdom_hall',
  cartLocationId: null,
  placeText: 'Hall street 1',
  note: null,
  sortOrder: 0,
  ...o,
});

// August visit: Tue 4 – Sun 9. February visit: Tue 23 – Sun 28.
const FEB = daysOf('2027-02-23', '2027-02-28');

describe('the last visit week carried to an empty one', () => {
  it('knows its days and weekdays', () => {
    expect(FEB).toEqual([
      '2027-02-23',
      '2027-02-24',
      '2027-02-25',
      '2027-02-26',
      '2027-02-27',
      '2027-02-28',
    ]);
    expect(isoWeekday('2027-02-23')).toBe(2);
    expect(isoWeekday('2027-02-28')).toBe(7);
    expect(daysOf('2027-02-23', null)).toEqual(['2027-02-23']);
  });

  it('moves each item to the same weekday and keeps hour, place and kind of ministry', () => {
    const { items, skipped } = templateFrom(
      [src({ itemDate: '2026-08-05', note: 'door to door' })],
      FEB,
      new Set(),
    );
    expect(skipped).toBe(0);
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'field_service',
        itemDate: '2027-02-24',
        startTime: '10:00:00',
        placeKind: 'kingdom_hall',
        placeText: 'Hall street 1',
        note: 'door to door',
      }),
    ]);
  });

  it('never carries a person, and drops notes that may name one', () => {
    const { items } = templateFrom(
      [
        src({
          kind: 'pastoral',
          note: 'the Ozerov family',
          placeKind: null,
          placeText: null,
        }),
        src({
          kind: 'lunch',
          note: 'at the Smiths',
          placeKind: null,
          placeText: null,
        }),
        src({ kind: 'pioneers', note: 'theme of the meeting' }),
      ],
      FEB,
      new Set(),
    );
    expect(items.map((i) => [i.kind, i.note])).toEqual([
      ['pastoral', null],
      ['lunch', null],
      ['pioneers', 'theme of the meeting'],
    ]);
    for (const i of items)
      expect(Object.keys(i)).not.toContain('assigneePublisherId');
  });

  it("keeps the wife's own outing and leaves her old empty lunch copies and document reviews behind", () => {
    const { items } = templateFrom(
      [
        src({ forWife: true }),
        src({ kind: 'lunch', forWife: true }),
        src({ kind: 'lunch_box', forWife: true }),
        src({ kind: 'document_review' }),
        src({ withWife: true, startTime: '14:00' }),
      ],
      FEB,
      new Set(),
    );
    expect(items.map((i) => [i.kind, i.forWife, i.withWife])).toEqual([
      ['field_service', true, false],
      ['field_service', false, true],
    ]);
  });

  it('counts, never shifts, an item whose weekday the new visit lacks', () => {
    const { items, skipped } = templateFrom(
      [src({ itemDate: '2026-08-10' }) /* a Monday */, src({})],
      FEB,
      new Set(),
    );
    expect(skipped).toBe(1);
    expect(items).toHaveLength(1);
  });

  it('a stand no longer in use loses only its place', () => {
    const { items } = templateFrom(
      [
        src({
          placeKind: 'cart_location',
          cartLocationId: 'gone',
          placeText: null,
        }),
        src({
          placeKind: 'cart_location',
          cartLocationId: 'kept',
          placeText: null,
          startTime: '14:00',
        }),
      ],
      FEB,
      new Set(['kept']),
    );
    expect(items.map((i) => [i.placeKind, i.cartLocationId])).toEqual([
      [null, null],
      ['cart_location', 'kept'],
    ]);
  });
});
