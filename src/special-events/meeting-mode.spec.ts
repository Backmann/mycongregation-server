import { settleMeeting, takesMeetingMode, MeetingFields } from './meeting-mode';
import { eventMessage, reminderMessage, signatureOf } from './event-messages';

/**
 * Как идёт встреча в день события (27 сентября): как обычно, с изменениями,
 * встречи нет — у визита представителя филиала и у «Другого».
 */
const cur = (over: Partial<MeetingFields> = {}): MeetingFields => ({
  type: 'branch_representative_visit',
  meetingMode: 'usual',
  meetingNote: null,
  meetingTime: null,
  meetingAddress: null,
  replacesMeeting: false,
  ...over,
});

describe('settleMeeting', () => {
  it('«с изменениями» хранит, что меняется, время и место', () => {
    expect(
      settleMeeting(cur(), {
        meetingMode: 'changed',
        meetingNote: '  Речь представителя вместо публичной ',
        meetingTime: '10:00',
        meetingAddress: 'Westfalenhalle',
      }),
    ).toEqual({
      meetingMode: 'changed',
      meetingNote: 'Речь представителя вместо публичной',
      meetingTime: '10:00',
      meetingAddress: 'Westfalenhalle',
      replacesMeeting: false,
    });
  });

  it('«встречи нет» — это replacesMeeting, для правил недели', () => {
    const r = settleMeeting(
      cur({ meetingMode: 'changed', meetingTime: '10:00' }),
      { meetingMode: 'none' },
    );
    expect(r).toMatchObject({
      meetingMode: 'none',
      replacesMeeting: true,
      meetingTime: null,
    });
  });

  it('«с изменениями» без единого слова — отказ', () => {
    expect(() =>
      settleMeeting(cur(), { meetingMode: 'changed', meetingNote: '  ' }),
    ).toThrow();
  });

  it('правка одного времени сохраняет прежние слова', () => {
    const r = settleMeeting(
      cur({ meetingMode: 'changed', meetingNote: 'Речь представителя' }),
      { meetingTime: '09:30' },
    );
    expect(r).toMatchObject({
      meetingNote: 'Речь представителя',
      meetingTime: '09:30',
    });
  });

  it('старое приложение шлёт только replacesMeeting', () => {
    expect(settleMeeting(cur(), { replacesMeeting: true }).meetingMode).toBe(
      'none',
    );
    expect(
      settleMeeting(cur({ meetingMode: 'none', replacesMeeting: true }), {
        replacesMeeting: false,
      }).meetingMode,
    ).toBe('usual');
    // «Нет» от старого приложения не стирает «с изменениями».
    expect(
      settleMeeting(cur({ meetingMode: 'changed', meetingNote: 'x' }), {
        replacesMeeting: false,
      }).meetingMode,
    ).toBe('changed');
  });

  it('у конгресса, Вечери и визита районного своё правило', () => {
    for (const type of [
      'regional_convention',
      'circuit_assembly',
      'memorial',
      'circuit_overseer_visit',
    ]) {
      expect(takesMeetingMode(type)).toBe(false);
      expect(
        settleMeeting(cur({ type }), { meetingMode: 'none' }),
      ).toMatchObject({ meetingMode: 'usual', replacesMeeting: false });
    }
    expect(takesMeetingMode(null)).toBe(true);
    expect(takesMeetingMode('other')).toBe(true);
  });
});

describe('что говорят собранию', () => {
  const e = {
    title: 'Посещение представителя филиала',
    type: 'branch_representative_visit',
    date: '2026-10-25',
    endDate: null,
    time: '10:00',
    timeEnd: null,
    address: null,
    replacesMeeting: false,
    meetingMode: 'changed',
    meetingNote: 'речь представителя вместо публичной',
    meetingTime: '10:00',
    meetingAddress: 'Westfalenhalle, Dortmund',
  };

  it('новое событие с изменениями', () => {
    expect(eventMessage('created', e, 'ru').body).toBe(
      'Воскресенье, 25 октября · начало в 10:00. Встреча собрания в этот день идёт с изменениями: речь представителя вместо публичной. Встреча: начало в 10:00 · Westfalenhalle, Dortmund.',
    );
  });

  it('накануне — то же', () => {
    expect(reminderMessage(e, 'ru').body).toContain('идёт с изменениями');
  });

  it('отмена возвращает встречу к обычной', () => {
    expect(eventMessage('cancelled', e, 'ru').body).toContain(
      'Встреча собрания в этот день идёт как обычно.',
    );
  });

  it('новое время или место встречи — повод сказать снова', () => {
    expect(signatureOf(e)).not.toBe(
      signatureOf({ ...e, meetingAddress: 'Königreichssaal' }),
    );
    expect(signatureOf(e)).not.toBe(
      signatureOf({ ...e, meetingMode: 'usual' }),
    );
  });
});
