jest.mock('expo-server-sdk', () => ({ Expo: class {} }));
import { LocalNeedsRemindersService } from './local-needs-reminders.service';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { clockStub } from '../common/testing/clock-stub';
import { setNow, restoreNow } from '../common/testing/set-now';

/**
 * Only the body of elders' coordinator hears of an empty «Местные
 * потребности» part, 14 days before and once more at 7 — and the words are
 * the date (Lionel, 28 October 2026).
 */
describe('LocalNeedsRemindersService', () => {
  let responsibilities: any;
  let localNeeds: any;
  let notifications: any;
  let service: LocalNeedsRemindersService;

  beforeEach(() => {
    // Wednesday 28 October 2026, morning in Berlin.
    setNow(Date.UTC(2026, 9, 28, 8, 0, 0));
    responsibilities = {
      find: jest.fn().mockResolvedValue([{ id: 'r', userId: 'u-coord' }]),
    };
    localNeeds = { unfilledWeeks: jest.fn().mockResolvedValue([]) };
    notifications = { notify: jest.fn() };
    service = new LocalNeedsRemindersService(
      { find: jest.fn() } as any,
      responsibilities,
      localNeeds,
      notifications,
      clockStub(),
    );
  });
  afterEach(() => restoreNow());

  const week = (weekStartDate: string, meetingDate: string) => ({
    weekStartDate,
    meetingDate,
  });

  it('asks only for the coordinator', async () => {
    await service.runFor('cong-1');
    expect(responsibilities.find.mock.calls[0][0].where.type).toBe(
      ResponsibilityType.BODY_COORDINATOR,
    );
  });

  it('says the first reminder within 14 days, to him alone, with the date', async () => {
    localNeeds.unfilledWeeks.mockResolvedValue([
      week('2026-11-09', '2026-11-11'), // 14 days ahead
    ]);
    await service.runFor('cong-1');
    const call = notifications.notify.mock.calls[0][0];
    expect(call.userIds).toEqual(['u-coord']);
    expect(call.key).toBe('local-needs:2026-11-09:14');
    expect(call.data.type).toBe('local_needs_reminder');
    const ru = call.text('ru');
    expect(ru.title).toBe('Местные потребности');
    expect(ru.body).toContain('11');
  });

  it('says the second one at 7 days, under its own key', async () => {
    localNeeds.unfilledWeeks.mockResolvedValue([
      week('2026-11-02', '2026-11-04'), // 7 days ahead
    ]);
    await service.runFor('cong-1');
    expect(notifications.notify.mock.calls[0][0].key).toBe(
      'local-needs:2026-11-02:7',
    );
  });

  it('says nothing three weeks ahead, nor without a coordinator', async () => {
    localNeeds.unfilledWeeks.mockResolvedValue([
      week('2026-11-16', '2026-11-18'), // 21 days
    ]);
    await service.runFor('cong-1');
    expect(notifications.notify).not.toHaveBeenCalled();

    localNeeds.unfilledWeeks.mockResolvedValue([
      week('2026-11-09', '2026-11-11'),
    ]);
    responsibilities.find.mockResolvedValue([]);
    await service.runFor('cong-1');
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
