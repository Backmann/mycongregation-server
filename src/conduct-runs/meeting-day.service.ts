import { Injectable } from '@nestjs/common';
import { WeekRulesService } from '../common/week-rules.service';
import { CongregationClock } from '../common/congregation-clock.service';
import { EventType } from '../common/enums/event-type.enum';
import type { ConductKind } from '../common/conduct-kind';

/**
 * WHETHER A WEEK'S MIDWEEK MEETING IS OVER — its day has passed in the
 * congregation's own time zone.
 *
 * Why it exists (16 October 2026): a run started on a phone the evening
 * after the meeting, as a try-out, was left in a counsel overnight. The next
 * morning the phone sent it on as the meeting «as it runs», and tried to save
 * it as the result — 9:16:38, a counsel of 555 minutes — in place of the real
 * one from Wednesday. The size limits refused it that time; this refuses the
 * kind of thing it was. After the day, a meeting is history: it is not run
 * again, and its result is not replaced.
 *
 * The day comes from the week rules (settings in force, a circuit overseer's
 * visit that moves the meeting). A week with no midweek meeting has no day to
 * be over — callers treat it as not over and let their own rules speak.
 */
@Injectable()
export class MeetingDayService {
  constructor(
    private readonly weekRules: WeekRulesService,
    private readonly clock: CongregationClock,
  ) {}

  /** The midweek meeting's date that week, or null when none is held. */
  async midweekDate(
    congregationId: string,
    week: string,
  ): Promise<string | null> {
    return this.meetingDate(congregationId, week, EventType.MIDWEEK);
  }

  /** That week's meeting of this kind, its date — or null when none is held. */
  async meetingDate(
    congregationId: string,
    week: string,
    kind: ConductKind,
  ): Promise<string | null> {
    const ctx = await this.weekRules.contextOf(congregationId);
    const rules = this.weekRules.rulesFrom(ctx, week);
    return (
      rules.meetings.find((m) => (m.kind as string) === kind)?.date ?? null
    );
  }

  /** True once the day of that week's meeting (midweek unless said) has passed. */
  async isOver(
    congregationId: string,
    week: string,
    kind: ConductKind = EventType.MIDWEEK,
  ): Promise<boolean> {
    const date = await this.meetingDate(congregationId, week, kind);
    if (!date) return false;
    return date < (await this.clock.todayFor(congregationId));
  }
}
