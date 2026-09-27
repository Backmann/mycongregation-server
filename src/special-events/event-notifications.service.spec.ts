// The push SDK ships as ESM, which jest does not load; nothing here pushes.
jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import { EventNotificationsService } from './event-notifications.service';
import { clockStub } from '../common/testing/clock-stub';
import type { SpecialEvent } from '../entities/special-event.entity';

/**
 * Who is told, when, and only once — Berlin, whose evening in late September
 * is UTC+2: 18:00 local is 16:00 UTC.
 */
const ev = (over: Partial<SpecialEvent>): SpecialEvent =>
  ({
    id: 'e1',
    congregationId: 'cong-1',
    title: 'Районный конгресс',
    type: 'circuit_assembly',
    date: '2026-11-08',
    endDate: null,
    time: '09:40',
    timeEnd: null,
    address: 'Kongresssaal Hamm',
    replacesMeeting: false,
    coMidweekDow: null,
    ...over,
  }) as SpecialEvent;

function build(events: SpecialEvent[], today = '2026-09-27') {
  const notify = jest.fn();
  const users = {
    find: jest.fn().mockResolvedValue([
      { id: 'u-ru', uiLanguage: 'ru' },
      { id: 'u-ru2', uiLanguage: 'ru' },
      { id: 'u-de', uiLanguage: 'de' },
    ]),
  };
  const eventsRepo = { find: jest.fn().mockResolvedValue(events) };
  const clock = clockStub('Europe/Berlin');
  jest.spyOn(clock, 'todayFor').mockResolvedValue(today);
  const svc = new EventNotificationsService(
    users as never,
    eventsRepo as never,
    clock,
    { notify } as never,
  );
  return { svc, notify };
}

describe('announcing an event', () => {
  it('tells everyone, each in their own language, under the events category', async () => {
    const { svc, notify } = build([]);
    await svc.announce(ev({}), 'created');
    expect(notify).toHaveBeenCalledTimes(2);
    const ru = notify.mock.calls.find((c) => c[0].userIds.includes('u-ru'))[0];
    expect(ru.userIds).toEqual(['u-ru', 'u-ru2']);
    expect(ru.kind).toBe('special_event');
    expect(ru.key).toBe('event:e1:created');
    expect(ru.data).toEqual({ type: 'special_event', eventId: 'e1' });
    const de = notify.mock.calls.find((c) => c[0].userIds.includes('u-de'))[0];
    expect(de.title).toMatch(/^Neues Ereignis/);
  });

  it('tells nobody about an event that is over', async () => {
    const { svc, notify } = build([]);
    await svc.announce(ev({ date: '2026-09-13' }), 'created');
    expect(notify).not.toHaveBeenCalled();
  });

  it('a change is said once per what it changed to', async () => {
    const a = EventNotificationsService.keyOf(
      'changed',
      ev({ time: '09:30' }),
      new Date(),
    );
    const b = EventNotificationsService.keyOf(
      'changed',
      ev({ time: '09:30' }),
      new Date(),
    );
    const c = EventNotificationsService.keyOf(
      'changed',
      ev({ time: '10:00' }),
      new Date(),
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('the evening before', () => {
  // Saturday 7 November 2026; Berlin is UTC+1 after the clocks change.
  const at = (utc: string) => new Date(`2026-11-07T${utc}:00Z`);

  it('not before 18:00 local', async () => {
    const { svc, notify } = build([ev({})]);
    expect(await svc.remindEveningBefore(at('16:59'))).toBe(0); // 17:59
    expect(notify).not.toHaveBeenCalled();
  });

  it('from 18:00 local, with the day in the key', async () => {
    const { svc, notify } = build([ev({})]);
    expect(await svc.remindEveningBefore(at('17:00'))).toBe(1); // 18:00
    expect(notify.mock.calls[0][0].key).toBe('event:e1:eve:2026-11-08');
    expect(notify.mock.calls[0][0].title).toBe('Завтра — Районный конгресс');
  });

  it('not from 21:00 local — a missed evening does not become a wrong «tomorrow» in the morning', async () => {
    const { svc, notify } = build([ev({})]);
    expect(await svc.remindEveningBefore(at('20:00'))).toBe(0); // 21:00
    expect(notify).not.toHaveBeenCalled();
  });

  it('a visit is reminded on the eve of its midweek meeting', async () => {
    const visit = ev({
      type: 'circuit_overseer_visit',
      title: 'Посещение районного',
      date: '2026-11-02',
      endDate: '2026-11-08',
      coMidweekDow: 7, // an unusual Sunday, to prove the day is taken from the event
    });
    const { svc, notify } = build([visit]);
    expect(await svc.remindEveningBefore(at('17:00'))).toBe(1);
    expect(notify.mock.calls[0][0].key).toBe('event:e1:eve:2026-11-08');
  });

  it('nothing for an event that is not tomorrow', async () => {
    const { svc } = build([ev({ date: '2026-11-09' })]);
    expect(await svc.remindEveningBefore(at('17:00'))).toBe(0);
  });
});
