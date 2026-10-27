import { DutyType } from '../common/enums/duty-type.enum';
import {
  PlaceSpec,
  SheetRow,
  defaultPlaces,
  placesProblem,
  planSheet,
  rowsOfPlaces,
} from './duty-places';

/**
 * How a sheet follows its template (Lionel, 27 October 2026): a person is
 * never taken off a place by a change of the template.
 */
describe('duty places: a sheet following its template', () => {
  const place = (
    dutyType: DutyType,
    over: Partial<PlaceSpec> = {},
  ): PlaceSpec => ({
    dutyType,
    customLabel: null,
    count: 1,
    notes: null,
    capability: null,
    ...over,
  });
  const own = (label: string, over: Partial<PlaceSpec> = {}) =>
    place(DutyType.CUSTOM, { customLabel: label, ...over });

  let n = 0;
  const row = (
    dutyType: DutyType,
    slotIndex: number,
    sortOrder: number,
    over: Partial<SheetRow> = {},
  ): SheetRow => ({
    id: `r${++n}`,
    dutyType,
    customLabel: null,
    slotIndex,
    sortOrder,
    notes: null,
    publisherId: null,
    ...over,
  });

  it('a new sheet is exactly what the code made before, while nothing is kept', () => {
    const rows = rowsOfPlaces(defaultPlaces(2));
    expect(rows.map((r) => [r.dutyType, r.slotIndex, r.sortOrder])).toEqual([
      ['security', 0, 1],
      ['attendant', 0, 2],
      ['microphone', 0, 3],
      ['microphone', 1, 3],
      ['av', 0, 4],
      ['zoom', 0, 5],
      ['stage', 0, 6],
      ['ventilation', 0, 7],
      ['timekeeper', 0, 8],
    ]);
  });

  it('own places share one running slot, each with its note', () => {
    const rows = rowsOfPlaces([
      own('Стоянка', { count: 2, notes: 'жилетки' }),
      own('Гардероб'),
    ]);
    expect(
      rows.map((r) => [r.customLabel, r.slotIndex, r.sortOrder, r.notes]),
    ).toEqual([
      ['Стоянка', 0, 1, 'жилетки'],
      ['Стоянка', 1, 1, 'жилетки'],
      ['Гардероб', 2, 2, null],
    ]);
  });

  it('a place added appears empty; the people elsewhere stay', () => {
    const rows = [
      row(DutyType.SECURITY, 0, 1, { publisherId: 'p1' }),
      row(DutyType.ATTENDANT, 0, 2),
    ];
    const plan = planSheet(
      rows,
      [place(DutyType.SECURITY), place(DutyType.ATTENDANT)],
      [place(DutyType.SECURITY), own('Стоянка'), place(DutyType.ATTENDANT)],
      new Map(),
    );
    expect(plan.insert).toEqual([
      {
        dutyType: DutyType.CUSTOM,
        customLabel: 'Стоянка',
        slotIndex: 0,
        sortOrder: 2,
        notes: null,
      },
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([{ id: rows[1].id, sortOrder: 3 }]);
    expect(plan.kept).toEqual([]);
  });

  it('a rename follows the people at it', () => {
    const rows = [
      row(DutyType.CUSTOM, 0, 1, {
        customLabel: 'Парковка',
        publisherId: 'p1',
      }),
    ];
    const plan = planSheet(
      rows,
      [own('Парковка')],
      [own('Стоянка')],
      new Map([['Парковка', 'Стоянка']]),
    );
    expect(plan.update).toEqual([{ id: rows[0].id, customLabel: 'Стоянка' }]);
    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([]);
  });

  it('a place removed goes where it is empty and stays where somebody stands', () => {
    const empty = [row(DutyType.ZOOM, 0, 1), row(DutyType.AV, 0, 2)];
    const taken = [
      row(DutyType.ZOOM, 0, 1, { publisherId: 'p1' }),
      row(DutyType.AV, 0, 2),
    ];
    const was = [place(DutyType.ZOOM), place(DutyType.AV)];
    const now = [place(DutyType.AV)];
    const a = planSheet(empty, was, now, new Map());
    expect(a.remove).toEqual([empty[0].id]);
    expect(a.kept).toEqual([]);
    const b = planSheet(taken, was, now, new Map());
    expect(b.remove).toEqual([]);
    expect(b.kept.map((r) => r.id)).toEqual([taken[0].id]);
    // After the template's places.
    expect(b.update).toEqual(
      expect.arrayContaining([
        { id: taken[1].id, sortOrder: 1 },
        { id: taken[0].id, sortOrder: 2 },
      ]),
    );
  });

  it('fewer people: only empty rows go, from the last', () => {
    const rows = [
      row(DutyType.MICROPHONE, 0, 1, { publisherId: 'p1' }),
      row(DutyType.MICROPHONE, 1, 1),
      row(DutyType.MICROPHONE, 2, 1, { publisherId: 'p3' }),
    ];
    const plan = planSheet(
      rows,
      [place(DutyType.MICROPHONE, { count: 3 })],
      [place(DutyType.MICROPHONE, { count: 1 })],
      new Map(),
    );
    expect(plan.remove).toEqual([rows[1].id]);
    expect(plan.kept.map((r) => r.id)).toEqual([rows[2].id]);
  });

  it('more people: rows are added after the last slot', () => {
    const rows = [
      row(DutyType.MICROPHONE, 0, 1),
      row(DutyType.MICROPHONE, 1, 1),
    ];
    const plan = planSheet(
      rows,
      [place(DutyType.MICROPHONE, { count: 2 })],
      [place(DutyType.MICROPHONE, { count: 3 })],
      new Map(),
    );
    expect(plan.insert.map((r) => r.slotIndex)).toEqual([2]);
  });

  it('a place added for one evening is that evening’s and stays as it is', () => {
    const rows = [
      row(DutyType.SECURITY, 0, 1),
      row(DutyType.CUSTOM, 0, 2, { customLabel: 'Свадьба' }),
    ];
    const plan = planSheet(
      rows,
      [place(DutyType.SECURITY)],
      [place(DutyType.SECURITY)],
      new Map(),
    );
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.kept).toEqual([]);
  });

  it('a note follows the template unless the evening wrote its own', () => {
    const rows = [
      row(DutyType.CUSTOM, 0, 1, { customLabel: 'Стоянка', notes: 'жилетки' }),
      row(DutyType.CUSTOM, 1, 1, {
        customLabel: 'Стоянка',
        notes: 'только сегодня — фонарь',
      }),
    ];
    const plan = planSheet(
      rows,
      [own('Стоянка', { count: 2, notes: 'жилетки' })],
      [own('Стоянка', { count: 2, notes: 'жилетки в шкафу' })],
      new Map(),
    );
    expect(plan.update).toEqual([{ id: rows[0].id, notes: 'жилетки в шкафу' }]);
  });

  it('refuses a list it could not keep', () => {
    expect(placesProblem([])).toMatch(/at least one/);
    expect(placesProblem([own('  ')])).toMatch(/name/);
    expect(placesProblem([own('A'), own('a')])).toMatch(/once/);
    expect(placesProblem([place(DutyType.AV), place(DutyType.AV)])).toMatch(
      /once/,
    );
    expect(placesProblem([place(DutyType.AV, { count: 11 })])).toMatch(
      /1 to 10/,
    );
    expect(placesProblem([own('X', { capability: 'duty_flying' })])).toMatch(
      /capability/,
    );
    expect(placesProblem(defaultPlaces(2))).toBeNull();
  });
});
