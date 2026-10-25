import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LocalNeedsTopic } from '../entities/local-needs-topic.entity';
import { In, Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';

/**
 * Weekend programme part keys. Watchtower study parts and the public
 * talk belong to the weekend meeting; everything else is midweek.
 */
function isWeekendPartKey(partKey: string): boolean {
  return (
    partKey.startsWith('weekend_') ||
    partKey.startsWith('watchtower_') ||
    partKey.startsWith('public_talk')
  );
}
import { extractPartTitle, ParsedPart } from './part-title';
import { ImportResultDto, WeekImportSummary } from './dto/import-result.dto';
import { ApplyParsedDto } from './dto/apply-parsed.dto';
import { MeetingAttendanceService } from '../meeting-attendance/meeting-attendance.service';
import {
  CoVisitTemplateService,
  WATCHTOWER_VISIT_DURATION_MIN,
} from '../special-events/co-visit-template.service';
import { mendPlan } from '../special-events/co-visit-held';
import { TalkExchangeService } from '../talk-exchange/talk-exchange.service';
import { ProgrammeFreezeService } from '../assignments/programme-freeze.service';

/**
 * A part nobody has filled — the import may rewrite its title.
 *
 * «Filled» is not only one of ours on it. The public talk is filled by a
 * visiting speaker, by a talk from the catalogue or by a special theme just
 * as well, and a part may carry a name typed by hand (the circuit overseer on
 * a prayer). Only a publisher used to count, so loading the Watchtower again
 * wiped the theme of every week whose speaker came from elsewhere.
 *
 * That was put right on 27 September — in WtImportService, which the app had
 * stopped calling on 12 June: since then both publications come in through
 * `applyParsed` here. The correction never ran. Found on 5 October, before
 * that service was removed as dead code; the rule now lives where the import
 * does.
 */
function isEmptyTemplate(a: Assignment): boolean {
  return (
    !a.publisherId &&
    !a.assistantPublisherId &&
    !a.speakerName?.trim() &&
    !a.visitingSpeakerId &&
    !a.publicTalkId &&
    !a.specialTalk
  );
}

@Injectable()
export class MwbImportService {
  private readonly logger = new Logger(MwbImportService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    private readonly meetingAttendance: MeetingAttendanceService,
    private readonly coVisitTemplate: CoVisitTemplateService,
    private readonly talkExchange: TalkExchangeService,
    /** The programme's freeze: a week already the record is not loaded into. */
    private readonly freeze: ProgrammeFreezeService,
    /** One line per load in the journal of changes. */
    @Optional()
    private readonly auditLog?: AuditLogService,
  ) {}

  /**
   * Which weeks already have a programme, month by month.
   *
   * The import screen had no memory: it looked identical whether September was
   * loaded or nothing was, and the only way to find out was to leave and page
   * through the schedule. Loading the same workbook twice is harmless — filled
   * parts are skipped — but not knowing is what makes somebody do it.
   *
   * Counted from the assignments themselves rather than from a log of imports:
   * a log would answer «what did I upload», and the question is «what does the
   * congregation have».
   */
  async coverage(congregationId: string): Promise<
    {
      month: string;
      weeks: number;
      parts: number;
      firstWeek: string;
      lastWeek: string;
    }[]
  > {
    const yearAgo = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const rows = await this.assignmentsRepo
      .createQueryBuilder('a')
      // As text, not as the DATE it is: node-postgres hands a DATE back as a
      // JavaScript Date, and this read took it for a string — «week.slice is
      // not a function», a 500 on every open of the import screen once any
      // programme was loaded (found by the screen audit, 24 September).
      .select("to_char(a.week_start_date, 'YYYY-MM-DD')", 'week')
      .addSelect('COUNT(*)', 'parts')
      .where('a.congregation_id = :congregationId', { congregationId })
      .andWhere('a.deleted_at IS NULL')
      .andWhere("a.event_type IN ('midweek','weekend')")
      // A year back is as far as anybody looks when asking «до какого месяца
      // программа загружена» — and it keeps this from scanning the whole
      // history of the congregation every time the screen opens.
      .andWhere('a.week_start_date >= :from', { from: yearAgo })
      .groupBy('a.week_start_date')
      .orderBy('a.week_start_date', 'ASC')
      .getRawMany<{ week: string | Date; parts: string }>();

    const byMonth = new Map<
      string,
      { weeks: number; parts: number; first: string; last: string }
    >();
    for (const row of rows) {
      // A Date still reads right, should the column ever come back as one:
      // node-postgres builds it at local midnight, so the local parts are the
      // calendar day — never toISOString, which would shift it a day east of UTC.
      const week =
        typeof row.week === 'string'
          ? row.week.slice(0, 10)
          : `${row.week.getFullYear()}-${String(row.week.getMonth() + 1).padStart(2, '0')}-${String(row.week.getDate()).padStart(2, '0')}`;
      // The MONTH of the week's Monday. A week straddling two months belongs
      // to the one it starts in — the same way the workbooks are named.
      const month = week.slice(0, 7);
      const acc = byMonth.get(month) ?? {
        weeks: 0,
        parts: 0,
        first: week,
        last: week,
      };
      acc.weeks += 1;
      acc.parts += Number(row.parts);
      acc.last = week;
      byMonth.set(month, acc);
    }

    return [...byMonth.entries()].map(([month, a]) => ({
      month,
      weeks: a.weeks,
      parts: a.parts,
      firstWeek: a.first,
      lastWeek: a.last,
    }));
  }

  /**
   * Applies a workbook or a Watchtower issue that was parsed on the CLIENT
   * (browser). The EPUB file itself never reaches the server — the payload
   * contains only derived schedule metadata. This is the only way a
   * programme is imported: the upload flow it once shared the per-week
   * upsert with was removed on 5 October 2026 (see part-title.ts).
   */
  async applyParsed(
    congregationId: string,
    dto: ApplyParsedDto,
  ): Promise<ImportResultDto> {
    const result: ImportResultDto = {
      epubFile: dto.epubFile ?? 'client-parsed.epub',
      year: dto.year ?? new Date().getFullYear(),
      weeksImported: 0,
      partsCreated: 0,
      partsUpdated: 0,
      partsSkipped: 0,
      unclassifiedParts: 0,
      weeks: [],
      errors: [],
      warnings: [],
      notices: [],
    };

    const touched: string[] = [];
    for (const week of dto.weeks) {
      const parts: ParsedPart[] = week.parts.map((p) => ({
        rawTitle: p.partTitle ?? null,
        rawNumber: null,
        rawSection: 'client',
        durationMin: p.partDurationMin ?? null,
        durationRawText: null,
        notes: [],
        partKey: p.partKey,
        partOrder: p.partOrder,
        classifierConfidence: 'high' as const,
        synthetic: p.partTitle == null,
      }));
      const summary = await this.importWeek(
        congregationId,
        week.weekStartDate,
        week.weekEndDate,
        week.biblePassage ?? '',
        parts,
        result,
        touched,
      );
      result.weeks.push(summary);
      if (!summary.notHeld && !summary.frozen) result.weeksImported++;
    }

    // One line in the journal of changes for the whole load (sync audit M3):
    // it used to write none, so a load could be neither seen nor traced.
    if (touched.length > 0) {
      await this.auditLog?.logEvent({
        tenantId: congregationId,
        entityType: 'assignment',
        entityId: touched[0],
        action: 'CREATE' as never,
        detail: {
          bulk: true,
          count: touched.length,
          weeks: result.weeks
            .filter((w) => !w.notHeld && !w.frozen)
            .map((w) => w.weekStartDate),
        },
      });
    }

    this.logger.log(
      `Applied client-parsed ${result.epubFile}: ${result.weeksImported} weeks, ` +
        `${result.partsCreated} created, ${result.partsUpdated} updated, ` +
        `${result.partsSkipped} skipped`,
    );

    return result;
  }

  private async importWeek(
    congregationId: string,
    weekStartDate: string,
    weekEndDate: string,
    biblePassage: string,
    parts: ParsedPart[],
    overall: ImportResultDto,
    /** The rows this load created or filled, for its journal line. */
    touched: string[],
  ): Promise<WeekImportSummary> {
    const summary: WeekImportSummary = {
      weekStartDate,
      weekEndDate,
      biblePassage,
      created: 0,
      updated: 0,
      skipped: 0,
    };

    // Determine the meeting from the parts: weekend part keys (Watchtower,
    // public talk) mean this is a weekend programme; otherwise midweek.
    const weekEventType = parts.some((p) => isWeekendPartKey(p.partKey))
      ? EventType.WEEKEND
      : EventType.MIDWEEK;

    // A meeting the week does not hold gets no programme.
    //
    // The Memorial takes a meeting away, and so do a convention and an event
    // flagged «в этот день обычной встречи нет». Nothing here knew that: the
    // workbook was applied week by week regardless, so parts could be created
    // for an evening the congregation does not meet — and the schedule would
    // then show them hidden behind the Memorial, waiting to confuse somebody.
    //
    // Two doors to this were already shut — duties refuse to be generated for
    // a displaced meeting, attendance does not ask about one. This was the
    // third, and the only reason it never caused harm is that the workbook
    // happens not to print a midweek programme for that week. That is the
    // publication's habit, not a rule of ours to rely on.
    //
    // Skipped LOUDLY: a silent skip is what made the new-year week vanish for
    // a whole year with nobody able to explain the empty schedule.
    const held = await this.meetingAttendance.pendingForWeek(
      congregationId,
      weekStartDate,
    );
    if (!held.some((m) => m.eventType === weekEventType)) {
      // Counted in the total as well as in the week. Only the week used to
      // get the number, so the screen said «Пропущено: 0» right above the
      // sentence saying thirteen parts had been left out (5 October).
      summary.skipped = parts.length;
      summary.notHeld = true;
      overall.partsSkipped += parts.length;
      overall.warnings.push(
        `Week ${weekStartDate}: the congregation holds no ${weekEventType} meeting that week (an event takes its place), so ${parts.length} part(s) were not imported.`,
      );
      overall.notices.push({
        code: 'meeting_not_held',
        weekStartDate,
        meeting: weekEventType === EventType.WEEKEND ? 'weekend' : 'midweek',
        parts: parts.length,
      });
      return summary;
    }
    // A week already the record is not loaded into (13 October 2026): an
    // old workbook loaded again used to fill its empty parts a year later.
    // Said out loud, like the meeting not held above.
    const lock = await this.freeze.lockOf(congregationId, {
      weekStartDate,
      eventType: weekEventType,
    });
    if (lock.frozen) {
      summary.skipped = parts.length;
      summary.frozen = true;
      overall.partsSkipped += parts.length;
      overall.warnings.push(
        `Week ${weekStartDate}: its ${weekEventType} meeting was held more than a week ago and its programme is part of the record, so ${parts.length} part(s) were not imported.`,
      );
      overall.notices.push({
        code: 'week_frozen',
        weekStartDate,
        meeting: weekEventType === EventType.WEEKEND ? 'weekend' : 'midweek',
        parts: parts.length,
        editableUntil: lock.editableUntil,
      });
      return summary;
    }
    // Load existing assignments for this week (active + soft-deleted)
    const existing = await this.assignmentsRepo.find({
      where: {
        congregationId,
        weekStartDate,
        eventType: weekEventType,
      },
      withDeleted: false,
    });
    // A circuit visit holds part of this week: rows it added, fields it
    // changed. The import leaves those alone — and first puts right what an
    // earlier import, which did not know to, has already done to them.
    const ofVisit = await this.coVisitTemplate.heldForWeek(
      congregationId,
      weekStartDate,
    );
    const mends = mendPlan(
      existing,
      ofVisit,
      parts.map((p) => ({
        partKey: p.partKey,
        partTitle: extractPartTitle(p),
        partOrder: p.partOrder,
        durationMin: p.durationMin ?? null,
      })),
      WATCHTOWER_VISIT_DURATION_MIN,
    );
    for (const mend of mends) {
      const row = existing.find((a) => a.id === mend.id);
      if (!row) continue;
      if (mend.partTitle === null) row.partTitle = null;
      if (mend.partOrder !== undefined) row.partOrder = mend.partOrder;
      if (mend.partDurationMin !== undefined) {
        row.partDurationMin = mend.partDurationMin;
      }
      await this.assignmentsRepo.save(row);
    }

    const byPartKey = new Map<string, Assignment>();
    for (const a of existing) {
      // The visit's own row is never the one a workbook part lands on: its
      // closing-song row shares a key with the workbook's middle song.
      if (ofVisit.added.has(a.id)) continue;
      byPartKey.set(a.partKey, a);
    }

    // The parts the visit hid are still there, out of sight. The workbook's
    // study goes onto the hidden one — it used to be created anew beside it
    // and folded away a moment later, which the screen reported as «+2
    // создано» in a week where nothing new could be seen.
    const hiddenByKey = new Map<string, Assignment>();
    if (ofVisit.hidden.size > 0) {
      const hidden = await this.assignmentsRepo.find({
        where: { id: In([...ofVisit.hidden]), congregationId },
        withDeleted: true,
      });
      for (const a of hidden) {
        if (!a.deletedAt) continue;
        if (a.weekStartDate !== weekStartDate) continue;
        if (a.eventType !== weekEventType) continue;
        hiddenByKey.set(a.partKey, a);
      }
    }

    let keptByHand = 0;
    for (const part of parts) {
      // Skip unclassified parts (don't pollute DB with "unknown" partKey)
      if (part.partKey === 'unknown') {
        overall.unclassifiedParts++;
        overall.warnings.push(
          `Week ${weekStartDate}: unclassified part "${part.rawTitle}" (section=${part.rawSection})`,
        );
        overall.notices.push({
          code: 'unclassified_part',
          weekStartDate,
          title: part.rawTitle,
        });
        continue;
      }

      const partTitle = extractPartTitle(part);
      const existingForPart = byPartKey.get(part.partKey);

      const hiddenForPart = existingForPart
        ? undefined
        : hiddenByKey.get(part.partKey);
      if (hiddenForPart) {
        if (isEmptyTemplate(hiddenForPart)) {
          hiddenForPart.partOrder = part.partOrder;
          hiddenForPart.partTitle = partTitle;
          hiddenForPart.partDurationMin = part.durationMin ?? null;
          await this.assignmentsRepo.save(hiddenForPart);
          summary.updated++;
          overall.partsUpdated++;
        } else {
          summary.skipped++;
          overall.partsSkipped++;
        }
        continue;
      }

      if (!existingForPart) {
        // Create new
        const newAssignment = this.assignmentsRepo.create({
          congregationId,
          weekStartDate,
          eventType: weekEventType,
          partKey: part.partKey,
          partOrder: part.partOrder,
          partTitle,
          importedTitle: partTitle,
          partDurationMin: part.durationMin ?? null,
          status: AssignmentStatus.DRAFT,
        });
        await this.assignmentsRepo.save(newAssignment);
        touched.push(newAssignment.id);
        summary.created++;
        overall.partsCreated++;
      } else if (isEmptyTemplate(existingForPart)) {
        // Replace empty template — keep id, fill data from EPUB
        const kept = ofVisit.fields.get(existingForPart.id);
        existingForPart.partOrder = part.partOrder;
        // A title a person changed stays (sync audit M3): it is no longer
        // what the import last wrote — or, on a row from before that was
        // remembered, it carries a local-needs topic.
        const byHand =
          !!existingForPart.partTitle &&
          existingForPart.partTitle !== partTitle &&
          (existingForPart.importedTitle != null
            ? existingForPart.partTitle !== existingForPart.importedTitle
            : ((await this.assignmentsRepo.manager?.count(LocalNeedsTopic, {
                where: { congregationId, usedAssignmentId: existingForPart.id },
              })) ?? 0) > 0);
        if (byHand) {
          keptByHand++;
        } else if (!kept?.has('partTitle')) {
          existingForPart.partTitle = partTitle;
          existingForPart.importedTitle = partTitle;
        }
        if (!kept?.has('partDurationMin')) {
          existingForPart.partDurationMin = part.durationMin ?? null;
        }
        await this.assignmentsRepo.save(existingForPart);
        touched.push(existingForPart.id);
        summary.updated++;
        overall.partsUpdated++;
      } else {
        // Already filled — skip
        summary.skipped++;
        overall.partsSkipped++;
      }
    }

    if (keptByHand > 0) {
      overall.notices.push({
        code: 'kept_by_hand',
        weekStartDate,
        parts: keptByHand,
      });
    }

    /**
     * A week made by hand before its workbook came carries every numbered
     * part the app knows — a fourth «Применяй», a third «Христианская
     * жизнь» — and the workbook may have fewer. Those were left behind
     * and reported as missing 7 and 3 days before the meeting (sync audit
     * M6). Removed now: only numbered parts the workbook does not have,
     * with nobody in them and no title of their own.
     */
    if (weekEventType === EventType.MIDWEEK) {
      const keys = new Set(parts.map((p) => p.partKey));
      const extra = existing.filter(
        (a) =>
          !a.deletedAt &&
          !ofVisit.added.has(a.id) &&
          /^(apply_yourself|living_christians)_\d+$/.test(a.partKey) &&
          !keys.has(a.partKey) &&
          isEmptyTemplate(a) &&
          !a.partTitle?.trim(),
      );
      if (extra.length > 0) {
        await this.assignmentsRepo.softDelete(extra.map((a) => a.id));
        overall.notices.push({
          code: 'empty_parts_removed',
          weekStartDate,
          parts: extra.length,
        });
      }
    }

    // A circuit visit saved before this workbook came in: its week gets the
    // visit's programme now (service talk in place of the study).
    await this.coVisitTemplate.applyForWeek(congregationId, weekStartDate);

    // The weekend has a journal behind it. A talk arranged there before the
    // week existed goes into the new, empty slot — otherwise the speaker has
    // to be entered a second time. Like the rule above, this was written on
    // 27 September into the service the app no longer called.
    //
    // That service also had the journal mirror every weekend afterwards. Not
    // taken over as it was: for an ordinary week the slot filled here already
    // agrees with the entry it was filled from. One week does need the
    // mirror — the week of a circuit visit, where the visit has just put the
    // overseer's name into the slot of a programme that did not exist when
    // the visit was saved. `circuitVisitApplied` does nothing elsewhere.
    if (weekEventType === EventType.WEEKEND) {
      await this.talkExchange.fillEmptySlot(congregationId, weekStartDate);
      // The visit's opening song into the new line; and the study's songs,
      // now known, are compared with it (25 October 2026).
      await this.talkExchange.fillOpeningSong(congregationId, weekStartDate);
      await this.talkExchange.circuitVisitApplied(
        congregationId,
        weekStartDate,
      );
    }

    return summary;
  }
}
