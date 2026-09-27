import {
  eventMessage,
  reminderDayOf,
  reminderMessage,
  signatureOf,
  EventForMessage,
} from './event-messages';

const base: EventForMessage = {
  title: 'Районный конгресс',
  type: 'circuit_assembly',
  date: '2026-11-08',
  endDate: null,
  time: '09:40',
  timeEnd: '16:00',
  address: 'Kongresssaal Hamm',
  replacesMeeting: false,
};

describe('what the congregation is told', () => {
  it('a new convention: when, hours, place — and that the week has no meetings', () => {
    expect(eventMessage('created', base, 'ru')).toEqual({
      title: 'Новое событие: Районный конгресс',
      body: 'Воскресенье, 8 ноября · 09:40–16:00 · Kongresssaal Hamm. Встреч собрания на этой неделе не будет.',
    });
  });

  it('a visit: the day the midweek meeting moves to', () => {
    const visit: EventForMessage = {
      ...base,
      title: 'Посещение районного',
      type: 'circuit_overseer_visit',
      date: '2026-10-13',
      endDate: '2026-10-18',
      time: null,
      timeEnd: null,
      address: null,
      coMidweekDow: 2,
    };
    expect(eventMessage('created', visit, 'ru').body).toBe(
      '13 октября – 18 октября. Будняя встреча — вторник, 13 октября.',
    );
    // Cancelled: the week goes back to normal, and people are told so.
    expect(eventMessage('cancelled', visit, 'ru')).toEqual({
      title: 'Отменено: Посещение районного',
      body: '13 октября – 18 октября — события не будет. Программа недели вернулась к обычной.',
    });
    // Reminded on the eve of the moved meeting, not of the first day.
    expect(
      reminderDayOf({ ...visit, date: '2026-10-12', coMidweekDow: 3 }),
    ).toBe('2026-10-14');
    expect(
      reminderMessage(
        { ...visit, coFirstName: 'Иван', coLastName: 'Тестов' },
        'ru',
      ),
    ).toEqual({
      title: 'Завтра — Посещение районного',
      body: 'Будняя встреча с районным старейшиной — Иван Тестов.',
    });
  });

  it('the Memorial says which meeting it takes, by the kind of day', () => {
    const m = {
      ...base,
      title: 'Вечеря',
      type: 'memorial',
      date: '2027-03-22',
      time: '19:30',
      timeEnd: null,
      address: null,
    };
    expect(eventMessage('created', m, 'ru').body).toBe(
      'Понедельник, 22 марта · начало в 19:30. Вместо встречи в будний день.',
    );
  });

  it('an event that stands in for the meeting says so; one that does not, says nothing about meetings', () => {
    const other = {
      ...base,
      title: 'Субботник',
      type: 'other',
      date: '2026-10-10',
      time: '09:00',
      timeEnd: null,
      address: null,
    };
    expect(eventMessage('created', other, 'ru').body).toBe(
      'Суббота, 10 октября · начало в 09:00.',
    );
    expect(
      eventMessage('created', { ...other, replacesMeeting: true }, 'ru').body,
    ).toBe(
      'Суббота, 10 октября · начало в 09:00. Обычной встречи в этот день нет.',
    );
  });

  it('a change says what it is now', () => {
    expect(
      eventMessage('changed', { ...base, time: '09:30', timeEnd: null }, 'ru'),
    ).toEqual({
      title: 'Изменение: Районный конгресс',
      body: 'Теперь: Воскресенье, 8 ноября · начало в 09:30 · Kongresssaal Hamm. Встреч собрания на этой неделе не будет.',
    });
  });

  it('the evening before: hours and place', () => {
    expect(reminderMessage(base, 'ru')).toEqual({
      title: 'Завтра — Районный конгресс',
      body: '09:40–16:00 · Kongresssaal Hamm. Встреч собрания на этой неделе не будет.',
    });
  });

  it('speaks the reader’s language', () => {
    expect(eventMessage('created', base, 'de').title).toBe(
      'Neues Ereignis: Районный конгресс',
    );
    expect(eventMessage('created', base, 'en').body).toContain(
      'No congregation meetings this week.',
    );
  });

  it('a note or a link is not a change worth telling', () => {
    const withNote = { ...base, note: 'x', mapUrl: 'y' } as EventForMessage;
    expect(signatureOf(withNote)).toBe(signatureOf(base));
    expect(signatureOf({ ...base, time: '10:00' })).not.toBe(signatureOf(base));
  });
});
