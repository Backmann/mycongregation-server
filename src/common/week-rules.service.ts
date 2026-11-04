import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeetingSettings } from '../entities/meeting-settings.entity';
import { SpecialEvent } from '../entities/special-event.entity';
import { MeetingMove } from '../entities/meeting-move.entity';
import { weekRules, WeekEvent, WeekRules } from './week-rules';

/**
 * THE WEEK'S RULES, FETCHED ONCE.
 *
 * `week-rules.ts` holds the rule itself and is pure. Feeding it is the part
 * that had been copied: the duties service and the attendance service each
 * ran the same five queries, re-tagged the four event lists the same way, and
 * explained why in comments that had drifted into near-duplicates of each
 * other. A third caller — the readiness endpoint — would have made three.
 *
 * TWO THINGS THIS FIXES BEYOND THE DUPLICATION.
 *
 * ORDER. `versionForWeek` walks the versions in sequence and keeps the last
 * one that has come into force, so it is only correct on a list sorted by
 * `effectiveFrom` ascending — and its fallback, `versions[0]`, leans on the
 * same order. Both callers do sort today (checked), but nothing said they had
 * to. Here the sort is done once, by the service, so a caller cannot get it
 * wrong.
 *
 * COST. Asking for one week costs five queries. A range of ten weeks asked
 * week by week would cost fifty, for data that does not change between them.
 * `forRange` loads the context once and answers every week from it.
 *
 * WHAT THIS DOES NOT DECIDE: what a caller does when the congregation has no
 * meeting settings at all. Attendance refuses to answer (nobody should be
 * asked to record a meeting that has no day), while duties carries on (a
 * congregation still setting itself up must not be blocked). Both are right
 * for their own question, so the context is returned either way and the
 * caller keeps its own answer.
 */

/** Everything the rule needs, fetched once and reusable for any week. */
export interface WeekRulesContext {
  /** Sorted by effectiveFrom ascending — `versionForWeek` depends on it. */
  versions: MeetingSettings[];
  visits: SpecialEvent[];
  cancelling: SpecialEvent[];
  memorials: SpecialEvent[];
  flagged: SpecialEvent[];
  /** Events whose day keeps the meeting «with changes» — for its hour. */
  changed: SpecialEvent[];
  /**
   * One-week moves of a meeting (4 November 2026). Optional only for the
   * contexts specs build by hand; the loader always fills it.
   */
  moves?: MeetingMove[];
}

/**
 * The six queries the week rules stand on — the ONE place they are written
 * (4 November 2026).
 *
 * The attendance service and the duties service each ran their own copy, and
 * the duties copy had already fallen one query behind (no events «with
 * changes»). A rule taught something new — a one-off move of a meeting, next —
 * would have been seen by one of the three and not the others. A plain
 * function rather than only a method, so those services can call it over the
 * repositories they already hold without a new constructor dependency.
 */
export async function loadWeekRulesContext(
  settingsRepo: Repository<MeetingSettings>,
  eventsRepo: Repository<SpecialEvent>,
  congregationId: string,
): Promise<WeekRulesContext> {
  const versions = await settingsRepo.find({
    where: { congregationId },
    order: { effectiveFrom: 'ASC' },
  });
  const [visits, cancelling, memorials, flagged, changed] = await Promise.all([
    eventsRepo.find({
      where: { congregationId, type: 'circuit_overseer_visit' },
    }),
    // Events that REPLACE the congregation's own meetings. A circuit visit is
    // deliberately not among them: it moves a meeting, it does not cancel one.
    eventsRepo.find({
      where: [
        { congregationId, type: 'regional_convention' },
        { congregationId, type: 'circuit_assembly' },
      ],
    }),
    // The Memorial replaces ONE of that week's meetings, chosen by the kind
    // of day it falls on — not by "the meeting on the same day".
    eventsRepo.find({ where: { congregationId, type: 'memorial' } }),
    // Anything marked by hand as «в этот день обычной встречи нет». Fetched by
    // the FLAG rather than by a type, because that is the whole point of it:
    // it exists for events that have no rule of their own.
    eventsRepo.find({ where: { congregationId, replacesMeeting: true } }),
    // A meeting kept «with changes» may begin at another hour.
    eventsRepo.find({ where: { congregationId, meetingMode: 'changed' } }),
  ]);
  const moves = await movesOf(settingsRepo, congregationId);

  // Sorted here rather than trusted from the query, so that a future change
  // to the `order` clause cannot quietly change which settings version a week
  // is judged by.
  const sorted = [...versions].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom
      ? -1
      : a.effectiveFrom > b.effectiveFrom
        ? 1
        : 0,
  );
  return {
    versions: sorted,
    visits,
    cancelling,
    memorials,
    flagged,
    changed,
    moves,
  };
}

/**
 * The congregation's one-week moves, over the repository's own manager — so
 * the five services that already pass the two repositories need no third
 * constructor argument (the duties service is built positionally in forty
 * tests). A spec's hand-made repository has no manager: no moves there, and
 * the rules read exactly as before. A real repository always has one, and the
 * database test test/db/meeting-move.db-spec.ts holds the loader to it.
 */
async function movesOf(
  settingsRepo: Repository<MeetingSettings>,
  congregationId: string,
): Promise<MeetingMove[]> {
  const manager = (settingsRepo as Partial<Repository<MeetingSettings>>)
    .manager;
  if (typeof manager?.getRepository !== 'function') return [];
  return manager.getRepository(MeetingMove).find({ where: { congregationId } });
}

/**
 * The rule for one week, from a context already loaded — as a PLAIN FUNCTION.
 *
 * Not a method, on purpose. The duties service and the attendance service both
 * already hold the four event lists for reasons of their own (attendance reads
 * the settings versions for start times and the Memorial list for its own
 * line), so making them take a service just to re-tag those lists would mean a
 * new constructor argument in each — and the duties service is built
 * POSITIONALLY in four places across its forty tests, where an argument in the
 * wrong slot fails silently. Nothing here needs a repository, so nothing here
 * needs injecting.
 *
 * The four lists are re-tagged with the type they were QUERIED by rather than
 * read off the row: each was fetched by an explicit filter, so the kind is
 * known here, and the rule must not depend on a column a caller might not have
 * selected.
 */
/**
 * The events «with changes», tagged by the filter they were QUERIED by — like
 * the other lists, the rule must not depend on a column a caller (or a test
 * double) might not have selected.
 */
export function changedEvents(ctx: WeekRulesContext): WeekEvent[] {
  return (ctx.changed ?? []).map((e) => ({ ...e, meetingMode: 'changed' }));
}

export function rulesFromContext(
  ctx: WeekRulesContext,
  weekStart: string,
): WeekRules {
  const events: WeekEvent[] = [
    ...ctx.visits.map((e) => ({ ...e, type: 'circuit_overseer_visit' })),
    // Conventions and circuit assemblies cancel the week identically; the
    // query returns only those two, so either label gives the same answer.
    ...ctx.cancelling.map((e) => ({
      ...e,
      type: e.type ?? 'regional_convention',
    })),
    ...ctx.memorials.map((e) => ({ ...e, type: 'memorial' })),
    // These keep their OWN type: the flag rule needs to know what they are in
    // order to leave alone the ones that have a rule of their own.
    ...ctx.flagged.map((e) => ({ ...e, replacesMeeting: true })),
    // Only for the hour (timeOf). Their own type and flag go with them, so
    // the visit, congress and flag rules read them exactly as before.
    ...changedEvents(ctx),
  ];
  return weekRules({
    weekStart,
    versions: ctx.versions,
    events,
    moves: ctx.moves ?? [],
  });
}

@Injectable()
export class WeekRulesService {
  constructor(
    @InjectRepository(MeetingSettings)
    private readonly settingsRepo: Repository<MeetingSettings>,
    @InjectRepository(SpecialEvent)
    private readonly eventsRepo: Repository<SpecialEvent>,
  ) {}

  /** The queries, run once. */
  contextOf(congregationId: string): Promise<WeekRulesContext> {
    return loadWeekRulesContext(
      this.settingsRepo,
      this.eventsRepo,
      congregationId,
    );
  }

  /** The rule for one week, from a context already loaded. */
  rulesFrom(ctx: WeekRulesContext, weekStart: string): WeekRules {
    return rulesFromContext(ctx, weekStart);
  }

  /** The rule for one week, fetching the context for it. */
  async forWeek(congregationId: string, weekStart: string): Promise<WeekRules> {
    const ctx = await this.contextOf(congregationId);
    return this.rulesFrom(ctx, weekStart);
  }

  /**
   * The rule for several weeks, on ONE set of queries.
   *
   * Keyed by the week start exactly as given, so a caller can look its own
   * weeks back up without re-deriving anything.
   */
  async forWeeks(
    congregationId: string,
    weekStarts: string[],
  ): Promise<Map<string, WeekRules>> {
    const ctx = await this.contextOf(congregationId);
    const out = new Map<string, WeekRules>();
    for (const weekStart of weekStarts) {
      out.set(weekStart, this.rulesFrom(ctx, weekStart));
    }
    return out;
  }
}
