import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import {
  extractPartTitle,
  extractYearFromFilename,
  parseMwbBuffer,
  ParsedPart,
} from './mwb-parser';
import {
  ImportResultDto,
  WeekImportSummary,
} from './dto/import-result.dto';

/**
 * Returns true if an existing assignment is empty (no publisher and no
 * meaningful title) — and therefore safe to overwrite during EPUB import.
 */
function isEmptyTemplate(a: Assignment): boolean {
  return (
    !a.publisherId &&
    !a.assistantPublisherId
  );
}

@Injectable()
export class MwbImportService {
  private readonly logger = new Logger(MwbImportService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
  ) {}

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
      const summary = await this.importWeek(congregationId, week.weekStartDate, week.weekEndDate, week.biblePassage, week.parts, result);
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

    // Load existing assignments for this week (active + soft-deleted)
    const existing = await this.assignmentsRepo.find({
      where: {
        congregationId,
        weekStartDate,
        eventType: EventType.MIDWEEK,
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
          eventType: EventType.MIDWEEK,
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
