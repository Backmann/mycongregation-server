import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import { WeekRulesService } from '../common/week-rules.service';
import { addDaysISO, type MeetingKind } from '../common/week-rules';
import { countProgramme } from '../readiness/readiness.service';
import { mondayOf } from '../common/week';
import { Congregation } from '../entities/congregation.entity';
import { todayIn } from '../common/congregation-clock';

/** One meeting of a week, as «Файлы программы» shows it. */
export interface FileWeekSide {
  /** False: the meeting is not held that week (convention, Memorial…). */
  held: boolean;
  /** Parts on the record, cancelled ones aside. */
  parts: number;
  /**
   * Came from an EPUB: a part the import wrote (the workbook for the
   * midweek; for the weekend only the study article carries a title). Parts loaded before the
   * import began to remember its titles (24 October 2026) read false: the
   * screen says «есть программа» then, never «вручную».
   */
  fromFile: boolean;
  /** Titles changed by hand after the import (a second import keeps them). */
  byHand: number;
  /** The same count as the «N из M» badge. */
  assigned: number;
  total: number;
}

export interface FileWeek {
  weekStart: string;
  coVisit: boolean;
  midweek: FileWeekSide;
  weekend: FileWeekSide;
}

export interface ProgrammeFiles {
  weeks: FileWeek[];
  /** The last week in the window with the meeting's programme, or null. */
  loadedUntil: { midweek: string | null; weekend: string | null };
  /** The first held week from this one on without any programme, or null. */
  nextMissing: { midweek: string | null; weekend: string | null };
}

/** Weeks shown at most, so nobody asks the server for a decade. */
export const MAX_FILE_WEEKS = 30;
/** Two weeks back and sixteen ahead: a workbook covers two months. */
export const DEFAULT_FILE_WEEKS = 18;

/**
 * «Файлы программы» (Lionel, 20 November 2026: «понятный экран, в котором
 * можно определить, какие файлы добавлены, а значит, какие недели готовы, а
 * какие нет»). The EPUB never reaches the server, so the files themselves
 * are not known here — what they left is: the parts each week holds, and
 * whether the import wrote them.
 */
@Injectable()
export class ProgrammeFilesService {
  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(Congregation)
    private readonly congregationsRepo: Repository<Congregation>,
    private readonly weekRules: WeekRulesService,
  ) {}

  /**
   * From two weeks back (what just ran) to the default horizon; «today» is
   * the congregation's own day, never UTC.
   */
  async weeks(
    congregationId: string,
    opts: { from?: string; count?: number; now?: Date } = {},
  ): Promise<ProgrammeFiles> {
    const c = await this.congregationsRepo.findOne({
      where: { id: congregationId },
    });
    const todayISO = todayIn(opts.now ?? new Date(), c?.timezone);
    const from = mondayOf(opts.from ?? addDaysISO(todayISO, -14));
    const n = Math.max(
      1,
      Math.min(MAX_FILE_WEEKS, Math.floor(opts.count ?? DEFAULT_FILE_WEEKS)),
    );
    const starts = Array.from({ length: n }, (_, i) => addDaysISO(from, 7 * i));
    const last = starts[starts.length - 1];
    const rows = await this.assignmentsRepo.find({
      where: {
        congregationId,
        weekStartDate: Between(from, last),
      },
    });
    const rules = await this.weekRules.forWeeks(congregationId, starts);
    const thisWeek = mondayOf(todayISO);

    const side = (week: string, kind: MeetingKind): FileWeekSide => {
      const mine = rows.filter(
        (r) =>
          String(r.weekStartDate).slice(0, 10) === week &&
          r.eventType === (kind as string) &&
          r.status !== AssignmentStatus.CANCELLED,
      );
      const held = !!rules.get(week)?.meetings.some((m) => m.kind === kind);
      const fromFile = mine.some((r) => r.importedTitle != null);
      const byHand = mine.filter(
        (r) => r.importedTitle != null && r.partTitle !== r.importedTitle,
      ).length;
      const count = countProgramme(mine);
      return {
        held,
        parts: mine.length,
        fromFile,
        byHand,
        assigned: count.assigned,
        total: count.total,
      };
    };

    const weeks: FileWeek[] = starts.map((w) => ({
      weekStart: w,
      coVisit: !!rules.get(w)?.coVisit,
      midweek: side(w, 'midweek'),
      weekend: side(w, 'weekend'),
    }));
    const lastWith = (k: MeetingKind) =>
      [...weeks].reverse().find((w) => w[k].parts > 0)?.weekStart ?? null;
    const firstMissing = (k: MeetingKind) =>
      weeks.find(
        (w) => w.weekStart >= thisWeek && w[k].held && w[k].parts === 0,
      )?.weekStart ?? null;
    return {
      weeks,
      loadedUntil: {
        midweek: lastWith('midweek'),
        weekend: lastWith('weekend'),
      },
      nextMissing: {
        midweek: firstMissing('midweek'),
        weekend: firstMissing('weekend'),
      },
    };
  }
}
