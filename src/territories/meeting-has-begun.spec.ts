import { meetingHasBegun } from './meeting-time';

describe('meetingHasBegun (12 November 2026)', () => {
  const today = '2026-11-14';
  it('a day gone by has begun, a day to come has not', () => {
    expect(meetingHasBegun('2026-11-13', '18:00', today, 0)).toBe(true);
    expect(meetingHasBegun('2026-11-15', '09:00', today, 23 * 60)).toBe(false);
  });
  it('today: by its hour against the congregation clock', () => {
    expect(meetingHasBegun(today, '10:00', today, 9 * 60 + 59)).toBe(false);
    expect(meetingHasBegun(today, '10:00', today, 10 * 60)).toBe(true);
    expect(meetingHasBegun(today, '10:00:00', today, 14 * 60)).toBe(true);
  });
});
