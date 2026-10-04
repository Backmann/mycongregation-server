import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import type { WeekReadiness } from './readiness.service';

/**
 * WHO IS TOLD HOW FAR THE PROGRAMME IS.
 *
 * Those who assemble it — and nobody else. The duties coordinator reads the
 * same endpoint, because the duty figures are his and he has nowhere else to
 * read them, but the programme is not his to judge: «not enough: prayer,
 * reader» said to a man who can neither assign the reader nor is asked to
 * was a line he could do nothing about (4 October 2026).
 *
 * One list, read by the endpoint and by the home-screen summary both, so the
 * two cannot drift apart again.
 */
export const PROGRAMME_READINESS_READERS: readonly ResponsibilityType[] = [
  ResponsibilityType.LIFE_MINISTRY_OVERSEER,
  ResponsibilityType.BODY_COORDINATOR,
];

/**
 * The same weeks with the programme part taken out.
 *
 * It is not sent as `null`: installed apps read `programme.loaded` without
 * asking whether it is there, and the server is deployed before they are.
 * `loaded: false` is what those apps already treat as «say nothing about the
 * programme, show the duties only»; `withheld` tells a newer reader that the
 * silence is a rule and not a missing import.
 */
export function withoutProgramme(weeks: WeekReadiness[]): WeekReadiness[] {
  return weeks.map((w) => ({
    ...w,
    meetings: w.meetings.map((m) => ({
      ...m,
      programme: {
        loaded: false,
        assigned: 0,
        total: 0,
        missing: [],
        withheld: true,
      },
    })),
  }));
}
