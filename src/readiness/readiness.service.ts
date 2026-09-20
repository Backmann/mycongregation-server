import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { Duty } from '../entities/duty.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { MeetingKind, WeekSettingsVersion } from '../common/week-rules';
import {
  SINGLE_SLOT_DUTIES_AFTER_MIC,
  SINGLE_SLOT_DUTIES_BEFORE_MIC,
} from '../common/enums/duty-type.enum';
import { WeekRulesService } from '../common/week-rules.service';
import { addDaysISO } from '../common/week-rules';
import { mondayOf } from '../common/week';

/**
 * HOW FAR ALONG A DAY IS.
 *
 * Two questions, kept apart on purpose, because two different people answer
 * them and one should not be reproached for the other's work.
 *
 * THE PROGRAMME IS JUDGED. Every part of a meeting wants a person, and a part
 * without one is a hole somebody has to fill — so it is counted, named, and
 * called unready.
 *
 * THE DUTIES ARE ONLY COUNTED. «То назначают, то нет» — the congregation's own
 * words about ventilation, which has not been assigned once in eighteen
 * meetings while every other duty was. A duty left empty is not necessarily
 * undone: it may simply not be wanted that evening. Reporting «7 of 8» as a
 * shortfall would invent a rule the congregation never made. So the number is
 * reported and nothing is concluded from it. (A setting for which duties a
 * congregation uses would answer this properly; that is its own piece of work.)
 *
 * WHAT IS NOT COUNTED IN THE PROGRAMME:
 * - SONGS. Nobody is assigned to them, so counting them would leave every
 *   meeting permanently short.
 * - THE CIRCUIT OVERSEER'S SERVICE TALK. He gives it; the congregation has
 *   nobody to put there, and counting it would make a visit week impossible
 *   to complete.
 * - CANCELLED ROWS, and rows the congregation removed.
 *
 * DRAFTS COUNT AS ASSIGNED. A person written in is a part settled, whether or
 * not the week has been published yet — which is also how the badge on the
 * schedule screen has always counted. It is safe to say so here because this
 * endpoint is open only to those who assemble the programme.
 *
 * WHICH MEETINGS A WEEK HOLDS is not this module's business to decide: it asks
 * common/week-rules.service.ts, the one authority. A convention week answers
 * with no meetings at all, and so has nothing to be ready or unready about.
 */

/** Songs carry no person. */
const SONG_KEYS = new Set<string>([
  'mid_song',
  'weekend_song',
  'weekend_opening_song',
]);

/** Parts the congregation has nobody to assign. */
const NOT_OURS_TO_ASSIGN = new Set<string>(['co_service_talk']);

/**
 * A year of weeks at a time is plenty for any screen; the ceiling exists so
 * that a caller asking for a decade cannot make the server read one.
 */
const MAX_WEEKS = 53;

/** What the duties side falls back to when no settings are recorded. */
const DEFAULT_MICROPHONE_SLOTS = 2;

export interface ProgrammeReadiness {
  /** False when no programme has been imported for this meeting at all. */
  loaded: boolean;
  assigned: number;
  total: number;
  /** Part keys still without a person. The caller names them. */
  missing: string[];
}

export interface DutiesCount {
  /**
   * False when no rows have been written for this meeting yet. The count is
   * the same either way — this only says whether anybody has been here.
   */
  created: boolean;
  assigned: number;
  total: number;
}

export interface MeetingReadiness {
  date: string;
  kind: MeetingKind;
  programme: ProgrammeReadiness;
  duties: DutiesCount;
}

export interface WeekReadiness {
  weekStart: string;
  /** Empty in a convention week: the congregation holds no meetings. */
  meetings: MeetingReadiness[];
}

@Injectable()
export class ReadinessService {
  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(Duty)
    private readonly dutiesRepo: Repository<Duty>,
    private readonly weekRules: WeekRulesService,
  ) {}

  /**
   * `weekEnd` is EXCLUSIVE, as it is everywhere else in this API — the
   * assignments and duties endpoints both read it that way, and a second
   * meaning for one word would be worse than the extra day of arithmetic.
   */
  async forRange(
    congregationId: string,
    weekStartISO: string,
    weekEndISO: string,
  ): Promise<WeekReadiness[]> {
    const first = mondayOf(weekStartISO);
    const weeks: string[] = [];
    for (let w = first; w < weekEndISO; w = addDaysISO(w, 7)) {
      weeks.push(w);
      if (weeks.length > MAX_WEEKS) {
        throw new BadRequestException(
          `Range too wide: at most ${MAX_WEEKS} weeks at a time.`,
        );
      }
    }
    if (weeks.length === 0) return [];

    const last = weeks[weeks.length - 1];
    const [rules, assignments, duties] = await Promise.all([
      this.weekRules.forWeeks(congregationId, weeks),
      this.assignmentsRepo.find({
        where: { congregationId, weekStartDate: Between(first, last) },
      }),
      this.dutiesRepo.find({
        where: { congregationId, weekStartDate: Between(first, last) },
      }),
    ]);

    const progByKey = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const k = `${a.weekStartDate}|${a.eventType}`;
      const arr = progByKey.get(k) ?? [];
      arr.push(a);
      progByKey.set(k, arr);
    }
    const dutyByKey = new Map<string, Duty[]>();
    for (const d of duties) {
      const k = `${d.weekStartDate}|${d.eventType}`;
      const arr = dutyByKey.get(k) ?? [];
      arr.push(d);
      dutyByKey.set(k, arr);
    }

    return weeks.map((weekStart) => {
      const r = rules.get(weekStart);
      const meetings = (r?.meetings ?? []).map((m) => {
        const eventType =
          m.kind === 'midweek' ? EventType.MIDWEEK : EventType.WEEKEND;
        const key = `${weekStart}|${eventType}`;
        return {
          date: m.date,
          kind: m.kind,
          programme: countProgramme(progByKey.get(key) ?? []),
          duties: countDuties(dutyByKey.get(key) ?? [], r?.version ?? null),
        };
      });
      return { weekStart, meetings };
    });
  }
}

function countProgramme(rows: Assignment[]): ProgrammeReadiness {
  if (rows.length === 0) {
    return { loaded: false, assigned: 0, total: 0, missing: [] };
  }
  let assigned = 0;
  let total = 0;
  const missing: string[] = [];
  for (const a of rows) {
    if (SONG_KEYS.has(a.partKey)) continue;
    if (NOT_OURS_TO_ASSIGN.has(a.partKey)) continue;
    if (a.status === AssignmentStatus.CANCELLED) continue;
    total += 1;
    if (a.publisherId) assigned += 1;
    else missing.push(a.partKey);
  }
  return { loaded: true, assigned, total, missing };
}

/**
 * How many places a meeting has, when nothing has been written down yet.
 *
 * The fixed duties either side of the microphones, plus as many microphones as
 * the settings in force that week call for. Same source `micCount` reads on
 * the duties side; the two must not disagree.
 */
function placesFromSettings(version: WeekSettingsVersion | null): number {
  const mics = version?.microphoneSlots ?? DEFAULT_MICROPHONE_SLOTS;
  return (
    SINGLE_SLOT_DUTIES_BEFORE_MIC.length +
    SINGLE_SLOT_DUTIES_AFTER_MIC.length +
    mics
  );
}

function countDuties(
  rows: Duty[],
  version: WeekSettingsVersion | null,
): DutiesCount {
  // No rows means nobody has opened this week to assign anybody — not that the
  // meeting has no places. Counting them from the settings says «0 of 8» here
  // exactly as it does on a week somebody happened to scroll past.
  if (rows.length === 0) {
    return { created: false, assigned: 0, total: placesFromSettings(version) };
  }
  return {
    created: true,
    assigned: rows.filter((d) => d.publisherId).length,
    total: rows.length,
  };
}
