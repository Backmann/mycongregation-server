import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import {
  extractPartTitle,
  extractYearFromFilename,
  parseMwbBuffer,
  ParsedPart,
} from './mwb-parser';
import { ImportResultDto, WeekImportSummary } from './dto/import-result.dto';
import { ApplyParsedDto } from './dto/apply-parsed.dto';
import { MeetingAttendanceService } from '../meeting-attendance/meeting-attendance.service';

/**
 * Returns true if an existing assignment is empty (no publisher and no
 * meaningful title) — and therefore safe to overwrite during EPUB import.
 */
function isEmptyTemplate(a: Assignment): boolean {
  return !a.publisherId && !a.assistantPublisherId;
}

@Injectable()
export class MwbImportService {
  private readonly logger = new Logger(MwbImportService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    private readonly meetingAttendance: MeetingAttendanceService,
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
      .select('a.week_start_date', 'week')
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
      .getRawMany<{ week: string; parts: string }>();

    const byMonth = new Map<
      string,
      { weeks: number; parts: number; first: string; last: string }
    >();
    for (const row of rows) {
      const week =
        typeof row.week === 'string' ? row.week.slice(0, 10) : row.week;
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

  async import(
    congregationId: string,
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<ImportResultDto> {
    const year = extractYearFromFilename(fileName);
    const parsed = parseMwbBuffer(fileBuffer, year, fileName);

    const result: ImportResultDto = {
      epubFile: parsed.epubFile,
      year: parsed.year,
      weeksImported: 0,
      partsCreated: 0,
      partsUpdated: 0,
      partsSkipped: 0,
      unclassifiedParts: 0,
      weeks: [],
      errors: parsed.errors.slice(),
      warnings: [],
    };

    if (parsed.weeks.length === 0) {
      result.warnings.push(
        'No weekly schedules found in this EPUB. Is it a Meeting Workbook?',
      );
      return result;
    }

    for (const week of parsed.weeks) {
      const summary = await this.importWeek(
        congregationId,
        week.weekStartDate,
        week.weekEndDate,
        week.biblePassage,
        week.parts,
        result,
      );
      result.weeks.push(summary);
      result.weeksImported++;
    }

    this.logger.log(
      `Imported ${parsed.epubFile}: ${result.weeksImported} weeks, ` +
        `${result.partsCreated} created, ${result.partsUpdated} updated, ` +
        `${result.partsSkipped} skipped, ${result.unclassifiedParts} unclassified`,
    );

    return result;
  }

  /**
   * Applies a workbook that was parsed on the CLIENT (browser). The EPUB
   * file itself never reaches the server — the payload contains only
   * derived schedule metadata. Reuses the same idempotent per-week
   * upsert as the upload flow.
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
    };

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
      );
      result.weeks.push(summary);
      result.weeksImported++;
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
      summary.skipped = parts.length;
      overall.warnings.push(
        `Week ${weekStartDate}: the congregation holds no ${weekEventType} meeting that week (an event takes its place), so ${parts.length} part(s) were not imported.`,
      );
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
    const byPartKey = new Map<string, Assignment>();
    for (const a of existing) byPartKey.set(a.partKey, a);

    for (const part of parts) {
      // Skip unclassified parts (don't pollute DB with "unknown" partKey)
      if (part.partKey === 'unknown') {
        overall.unclassifiedParts++;
        overall.warnings.push(
          `Week ${weekStartDate}: unclassified part "${part.rawTitle}" (section=${part.rawSection})`,
        );
        continue;
      }

      const partTitle = extractPartTitle(part);
      const existingForPart = byPartKey.get(part.partKey);

      if (!existingForPart) {
        // Create new
        const newAssignment = this.assignmentsRepo.create({
          congregationId,
          weekStartDate,
          eventType: weekEventType,
          partKey: part.partKey,
          partOrder: part.partOrder,
          partTitle,
          partDurationMin: part.durationMin ?? null,
          status: AssignmentStatus.DRAFT,
        });
        await this.assignmentsRepo.save(newAssignment);
        summary.created++;
        overall.partsCreated++;
      } else if (isEmptyTemplate(existingForPart)) {
        // Replace empty template — keep id, fill data from EPUB
        existingForPart.partOrder = part.partOrder;
        existingForPart.partTitle = partTitle;
        existingForPart.partDurationMin = part.durationMin ?? null;
        await this.assignmentsRepo.save(existingForPart);
        summary.updated++;
        overall.partsUpdated++;
      } else {
        // Already filled — skip
        summary.skipped++;
        overall.partsSkipped++;
      }
    }

    return summary;
  }
}
