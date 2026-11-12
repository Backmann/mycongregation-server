/**
 * Whether a meeting has already begun, by the congregation's own clock
 * (12 November 2026): a meeting this morning that went out to a territory
 * keeps it on record when the territory is handed back in the afternoon.
 */
export function meetingHasBegun(
  date: string,
  startTime: string,
  today: string,
  nowMinutes: number,
): boolean {
  if (date !== today) return date < today;
  const [h, m] = startTime.split(':').map(Number);
  return h * 60 + (m || 0) <= nowMinutes;
}
