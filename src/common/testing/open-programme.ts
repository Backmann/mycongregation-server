import type { ProgrammeFreezeService } from '../../assignments/programme-freeze.service';

/**
 * A programme freeze that finds every meeting still ahead and open — for the
 * specs that test something else and were written before the programme froze
 * (13 October 2026). The freeze itself has specs of its own
 * (programme-freeze*.spec.ts), which use the real rule.
 */
export function openProgramme(): ProgrammeFreezeService {
  const lock = {
    meetingDate: '2999-12-31',
    editableUntil: '3000-01-07',
    held: false,
    frozen: false,
  };
  return {
    locks: async (
      _c: string,
      meetings: { weekStartDate: string; eventType: string }[],
    ) =>
      new Map(
        meetings.map((m) => [
          `${m.weekStartDate.slice(0, 10)}|${m.eventType}`,
          lock,
        ]),
      ),
    lockOf: async () => lock,
    mayFixAfterwards: async () => false,
    assertWritable: async () => ({ retroactive: false }),
    isFrozen: async () => false,
  } as unknown as ProgrammeFreezeService;
}
