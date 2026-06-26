import { generateCartSlots } from './cart-weeks.service';

describe('generateCartSlots', () => {
  const MON = '2026-06-29'; // a Monday

  it('divides an even window into full-step slots', () => {
    // Saturday (dow 6), one location, 10:00-16:00 step 90 -> 4 slots
    const slots = generateCartSlots(MON, [6], ['loc-1'], '10:00', '16:00', 90);
    expect(slots.map((s) => [s.startTime, s.endTime])).toEqual([
      ['10:00', '11:30'],
      ['11:30', '13:00'],
      ['13:00', '14:30'],
      ['14:30', '16:00'],
    ]);
    // Saturday = Monday + 5 days
    expect(slots.every((s) => s.date === '2026-07-04')).toBe(true);
    expect(slots.every((s) => s.locationId === 'loc-1')).toBe(true);
  });

  it('drops a trailing remainder shorter than one step', () => {
    // 10:00-15:00 step 90 -> 10:00,11:30,13:00 (last 14:30 would exceed 15:00)
    const slots = generateCartSlots(MON, [6], ['loc-1'], '10:00', '15:00', 90);
    expect(slots.map((s) => s.startTime)).toEqual(['10:00', '11:30', '13:00']);
  });

  it('multiplies across days and locations', () => {
    // 2 days x 2 locations x 2 slots (10:00,11:00 within 10:00-12:00 step 60)
    const slots = generateCartSlots(
      MON,
      [6, 7],
      ['loc-1', 'loc-2'],
      '10:00',
      '12:00',
      60,
    );
    expect(slots.length).toBe(2 * 2 * 2);
    // both Saturday (07-04) and Sunday (07-05) present
    const dates = [...new Set(slots.map((s) => s.date))].sort();
    expect(dates).toEqual(['2026-07-04', '2026-07-05']);
  });

  it('produces no slots when window is smaller than step', () => {
    expect(
      generateCartSlots(MON, [6], ['loc-1'], '10:00', '11:00', 90),
    ).toEqual([]);
  });
});
