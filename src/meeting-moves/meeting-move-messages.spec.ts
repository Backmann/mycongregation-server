import {
  minutesUntil,
  moveMessage,
  moveMessageForAssignee,
} from './meeting-move-messages';

const move = {
  kind: 'midweek' as const,
  from: { date: '2026-11-11', time: '19:00' },
  to: { date: '2026-11-12', time: '18:30', address: null },
  back: false,
};

describe('the words of a moved meeting', () => {
  it('says the new day and hour, the hall, and what it replaces', () => {
    expect(moveMessage(move, 'ru')).toEqual({
      title: 'Встреча переносится',
      body: 'Будняя встреча на этой неделе — четверг, 12 ноября, в 18:30, Зал Царства. Вместо: среда, 11 ноября, в 19:00.',
    });
  });

  it('names a place written on the move instead of the hall', () => {
    const m = moveMessage(
      { ...move, to: { ...move.to, address: 'Stadthalle Hamm' } },
      'ru',
    );
    expect(m.body).toContain('в 18:30, Stadthalle Hamm.');
  });

  it('only the hour changed: says the hour it replaces, not the day', () => {
    const m = moveMessage(
      { ...move, to: { date: '2026-11-11', time: '18:00', address: null } },
      'ru',
    );
    expect(m.body).toBe(
      'Будняя встреча на этой неделе — среда, 11 ноября, в 18:00, Зал Царства. Вместо 19:00.',
    );
  });

  it('back to usual: says so, with nothing «instead»', () => {
    const m = moveMessage(
      {
        ...move,
        from: move.to,
        to: { date: '2026-11-11', time: '19:00', address: null },
        back: true,
      },
      'ru',
    );
    expect(m).toEqual({
      title: 'Встреча — снова как обычно',
      body: 'Будняя встреча на этой неделе — как обычно: среда, 11 ноября, в 19:00, Зал Царства.',
    });
  });

  it('a person with a part reads his own heading and what he has', () => {
    const m = moveMessageForAssignee(
      move,
      ['Чтение Библии', 'Микрофон 2'],
      'ru',
    );
    expect(m.title).toBe('Ваше назначение переносится');
    expect(m.body).toMatch(
      /Вместо: среда, 11 ноября, в 19:00\. У вас: Чтение Библии, Микрофон 2\.$/,
    );
  });

  it('speaks German with «Sie» and English with the day first', () => {
    expect(moveMessage(move, 'de').body).toBe(
      'Die Zusammenkunft unter der Woche — Donnerstag, 12. November, um 18:30 Uhr, Königreichssaal. Statt Mittwoch, 11. November, um 19:00 Uhr.',
    );
    expect(moveMessageForAssignee(move, [], 'de').title).toBe(
      'Ihre Aufgabe ist verlegt',
    );
    expect(moveMessage(move, 'en').body).toBe(
      'This week’s midweek meeting — Thursday 12 November, at 18:30, Kingdom Hall. Instead of Wednesday 11 November, at 19:00.',
    );
  });
});

describe('how soon a meeting begins, by the congregation’s clock', () => {
  // 4 November 2026, 22:00 in Berlin (UTC+1).
  const now = new Date('2026-11-04T21:00:00Z');
  it('counts to the start the next evening', () => {
    expect(
      minutesUntil({ date: '2026-11-05', time: '19:00' }, now, 'Europe/Berlin'),
    ).toBe(21 * 60);
  });
  it('a meeting a week away is far', () => {
    expect(
      minutesUntil({ date: '2026-11-11', time: '19:00' }, now, 'Europe/Berlin'),
    ).toBe(7 * 1440 - 180);
  });
});
