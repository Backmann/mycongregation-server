import {
  diffLines,
  fingerprint,
  linesByPerson,
  messageOf,
  type CoNoticeItem,
} from './co-visit-notice';

const item = (o: Partial<CoNoticeItem>): CoNoticeItem => ({
  id: 'i1',
  kind: 'field_service',
  forWife: false,
  withWife: false,
  itemDate: '2027-02-24',
  startTime: '10:00:00',
  placeKind: 'kingdom_hall',
  placeText: null,
  cartLocationName: null,
  assigneePublisherId: 'p1',
  note: 'по домам',
  ...o,
});
const v = { name: 'Пётр Иванов', wife: 'Мария' };

describe('what a person is told about a visit', () => {
  it('only people named by their card, never a document review or an old wife lunch copy', () => {
    const m = linesByPerson([
      item({}),
      item({ id: 'i2', assigneePublisherId: null }),
      item({ id: 'i3', kind: 'document_review' }),
      item({ id: 'i4', kind: 'lunch', forWife: true }),
      item({ id: 'i5', forWife: true, assigneePublisherId: 'p2' }),
    ]);
    expect([...m.keys()].sort()).toEqual(['p1', 'p2']);
    expect(m.get('p2')![0].side).toBe('wife');
  });

  it('a lunch carries no place and no note — they are somebody’s home', () => {
    const l = linesByPerson([
      item({ kind: 'lunch', note: 'у Сафоновых', placeKind: null }),
    ]).get('p1')![0];
    expect([l.place, l.note]).toEqual([null, null]);
  });

  it('says «вам назначено» with the day, hour, the overseer, the hall and the kind of ministry', () => {
    const now = linesByPerson([item({})]).get('p1')!;
    const msg = messageOf(diffLines([], now), v, 'ru')!;
    expect(msg.title).toBe('Вам назначено — визит районного старейшины');
    expect(msg.body).toBe(
      'ср 24 · 10:00 — служение с районным старейшиной (Пётр Иванов), Зал Царства · по домам',
    );
  });

  it('names the wife for her partner, and the overseer with his wife on a lunch', () => {
    const now = linesByPerson([
      item({ forWife: true }),
      item({ id: 'l', kind: 'lunch', startTime: '12:15' }),
    ]).get('p1')!;
    const body = messageOf(diffLines([], now), v, 'ru')!.body;
    expect(body).toContain('служение с женой районного старейшины (Мария)');
    expect(body).toContain('обед у вас: районный старейшина с женой');
  });

  it('a change says what it is now and what it was', () => {
    const was = linesByPerson([item({})]).get('p1')!;
    const now = linesByPerson([
      item({
        placeKind: 'custom',
        placeText: 'стенд 1',
        itemDate: '2027-02-25',
      }),
    ]).get('p1')!;
    const msg = messageOf(diffLines(was, now), v, 'ru')!;
    expect(msg.title).toBe('Изменено — визит районного старейшины');
    expect(msg.body).toBe(
      'чт 25 · 10:00 — служение с районным старейшиной (Пётр Иванов), стенд 1 · по домам (было: ср 24 · 10:00, Зал Царства)',
    );
  });

  it('a changed kind of ministry says what it was', () => {
    const was = linesByPerson([item({})]).get('p1')!;
    const now = linesByPerson([item({ note: 'повторные' })]).get('p1')!;
    expect(messageOf(diffLines(was, now), v, 'ru')!.body).toContain(
      '(было: по домам)',
    );
  });

  it('a line taken away says so, in plain words for a sister too', () => {
    const was = linesByPerson([item({})]).get('p1')!;
    const msg = messageOf(diffLines(was, []), v, 'ru')!;
    expect(msg.title).toBe(
      'Вы больше не назначены — визит районного старейшины',
    );
    expect(msg.body).toBe(
      'ср 24 · 10:00 — служение с районным старейшиной (Пётр Иванов): вы больше не назначены',
    );
    expect(msg.body).not.toMatch(/брат/);
  });

  it('nothing changed — nothing said; a partner change elsewhere is not his news', () => {
    const was = linesByPerson([item({})]).get('p1')!;
    expect(messageOf(diffLines(was, was), v, 'ru')).toBeNull();
  });

  it('mixed news is one message, marked line by line, in time order', () => {
    const was = linesByPerson([
      item({ id: 'a' }),
      item({ id: 'b', startTime: '14:00' }),
    ]).get('p1')!;
    const now = linesByPerson([
      item({ id: 'a' }),
      item({ id: 'c', itemDate: '2027-02-27', startTime: '10:00' }),
    ]).get('p1')!;
    const msg = messageOf(diffLines(was, now), v, 'ru')!;
    expect(msg.title).toBe('Визит районного старейшины: изменения');
    expect(msg.body.split('\n')).toEqual([
      'ср 24 · 14:00 — служение с районным старейшиной (Пётр Иванов): вы больше не назначены',
      'Новое: сб 27 · 10:00 — служение с районным старейшиной (Пётр Иванов), Зал Царства · по домам',
    ]);
  });

  it('speaks German and English too, the hall in each language', () => {
    const now = linesByPerson([item({ note: null })]).get('p1')!;
    expect(messageOf(diffLines([], now), v, 'de')!.body).toBe(
      'Mi 24 · 10:00 — Predigtdienst mit dem Kreisaufseher Pётр Иванов, Königreichssaal'.replace(
        'Pётр',
        'Пётр',
      ),
    );
    expect(messageOf(diffLines([], now), v, 'en')!.body).toContain(
      'Kingdom Hall',
    );
  });

  it('the same lines give the same fingerprint, different ones another', () => {
    const a = linesByPerson([item({})]).get('p1')!;
    const b = linesByPerson([item({ startTime: '11:00' })]).get('p1')!;
    expect(fingerprint(a)).toBe(fingerprint(a.map((x) => ({ ...x }))));
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});
