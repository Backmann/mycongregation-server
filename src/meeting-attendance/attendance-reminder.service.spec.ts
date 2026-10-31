jest.mock('expo-server-sdk', () => ({ Expo: class {} }));

import {
  AttendanceReminderService,
  attendanceDueText,
} from './attendance-reminder.service';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { EventType } from '../common/enums/event-type.enum';

/**
 * The 20:00 reminder (31 October 2026): one person is told — the brother who
 * counts; if he is away or there is none, the one who stands in; if there is
 * none, the secretary.
 */
const T = 'cong-1';
const TODAY = '2026-10-29';

function build(opts: {
  held: { type: ResponsibilityType; userId: string }[];
  away?: string[]; // publisher ids away today
  unrecorded?: { date: string; eventType: EventType; time: string | null }[];
}) {
  const notify = jest.fn();
  const svc = new AttendanceReminderService(
    {
      find: jest.fn(async () => [{ id: T, timezone: 'Europe/Berlin' }]),
    } as never,
    { find: jest.fn(async () => opts.held) } as never,
    {
      find: jest.fn(async () =>
        opts.held.map((h) => ({ id: `p-${h.userId}`, userId: h.userId })),
      ),
    } as never,
    {
      find: jest.fn(async () =>
        (opts.away ?? []).map((publisherId) => ({ id: 'x', publisherId })),
      ),
    } as never,
    {
      unrecordedToday: jest.fn(
        async () =>
          opts.unrecorded ?? [
            { date: TODAY, eventType: EventType.MIDWEEK, time: '19:00' },
          ],
      ),
    } as never,
    { notify } as never,
  );
  return { svc, notify };
}

const RECORDER = {
  type: ResponsibilityType.ATTENDANCE_RECORDER,
  userId: 'rec',
};
const ASSISTANT = {
  type: ResponsibilityType.ATTENDANCE_RECORDER_ASSISTANT,
  userId: 'asst',
};
const SECRETARY = { type: ResponsibilityType.SECRETARY, userId: 'sec' };

describe('who is told', () => {
  it('the brother who counts', async () => {
    const { svc } = build({ held: [SECRETARY, ASSISTANT, RECORDER] });
    expect(await svc.whoIsTold(T, TODAY)).toBe('rec');
  });

  it('the one who stands in, when he is away that day', async () => {
    const { svc } = build({
      held: [SECRETARY, ASSISTANT, RECORDER],
      away: ['p-rec'],
    });
    expect(await svc.whoIsTold(T, TODAY)).toBe('asst');
  });

  it('the secretary, when neither is there', async () => {
    const { svc } = build({ held: [SECRETARY, ASSISTANT], away: ['p-asst'] });
    expect(await svc.whoIsTold(T, TODAY)).toBe('sec');
  });

  it('nobody, when nobody holds any of the three', async () => {
    const { svc } = build({ held: [] });
    expect(await svc.whoIsTold(T, TODAY)).toBeNull();
  });
});

describe('when', () => {
  it('in the congregation’s 20:00 hour, once a meeting, to one person', async () => {
    const { svc, notify } = build({ held: [RECORDER, SECRETARY] });
    // 19:05 UTC is 20:05 in Berlin at the end of October.
    expect(await svc.run(new Date('2026-10-29T19:05:00Z'))).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      userIds: ['rec'],
      kind: 'attendance_due',
      key: `attendance-due:${TODAY}:midweek`,
      data: { type: 'attendance_due' },
    });
  });

  it('not before 20:00, and not after the hour', async () => {
    const { svc, notify } = build({ held: [RECORDER] });
    await svc.run(new Date('2026-10-29T18:55:00Z'));
    await svc.run(new Date('2026-10-29T20:01:00Z'));
    expect(notify).not.toHaveBeenCalled();
  });

  it('not for a meeting that begins after 20:00 — it has its card', async () => {
    const { svc, notify } = build({
      held: [RECORDER],
      unrecorded: [
        { date: TODAY, eventType: EventType.MIDWEEK, time: '20:15' },
      ],
    });
    await svc.remindFor(T, TODAY);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('the words', () => {
  it('are short and name the meeting', () => {
    expect(attendanceDueText(EventType.MIDWEEK, 'ru')).toEqual({
      title: 'Посещаемость встречи',
      body: 'Будняя встреча сегодня ещё не внесена.',
    });
    expect(attendanceDueText(EventType.WEEKEND, 'de').body).toContain(
      'Wochenende',
    );
    expect(attendanceDueText(EventType.MEMORIAL, 'en').body).toContain(
      'Memorial',
    );
  });
});
