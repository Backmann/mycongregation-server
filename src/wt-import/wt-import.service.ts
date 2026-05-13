import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Assignment } from '../entities/assignment.entity';
import { EventType } from '../common/enums/event-type.enum';
import { AssignmentStatus } from '../common/enums/assignment-status.enum';
import {
  extractYearFromFilename,
  parseWtBuffer,
  ParsedWtPart,
} from './wt-parser';
import {
  ImportResultDto,
  WeekImportSummary,
} from '../mwb-import/dto/import-result.dto';

function isEmptyTemplate(a: Assignment): boolean {
  return (
    !a.publisherId &&
    !a.assistantPublisherId
  );
}

@Injectable()
export class WtImportService {
  private readonly logger = new Logger(WtImportService.name);

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
    const parsed = parseWtBuffer(fileBuffer, year, fileName);

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
        'No study articles found in this EPUB. Is it a Watchtower study edition?',
      );
      return result;
    }

    for (const week of parsed.weeks) {
      const summary = await this.importWeek(
        congregationId,
        week.weekStartDate,
        week.weekEndDate,
        week.articleTitle,
        week.parts,
        result,
      );
      result.weeks.push(summary);
      result.weeksImported++;
    }

    this.logger.log(
      `WT import ${parsed.epubFile}: ${result.weeksImported} weeks, ` +
        `${result.partsCreated} created, ${result.partsUpdated} updated, ` +
        `${result.partsSkipped} skipped`,
    );

    return result;
  }

  private async importWeek(
    congregationId: string,
    weekStartDate: string,
    weekEndDate: string,
    articleTitle: string,
    parts: ParsedWtPart[],
    overall: ImportResultDto,
  ): Promise<WeekImportSummary> {
    const summary: WeekImportSummary = {
      weekStartDate,
      weekEndDate,
      biblePassage: articleTitle, // we put article title here (no bible passage in WT structure)
      created: 0,
      updated: 0,
      skipped: 0,
    };

    const existing = await this.assignmentsRepo.find({
      where: {
        congregationId,
        weekStartDate,
        eventType: EventType.WEEKEND,
      },
      withDeleted: false,
    });
    const byPartKey = new Map<string, Assignment>();
    for (const a of existing) byPartKey.set(a.partKey, a);

    for (const part of parts) {
      const existingForPart = byPartKey.get(part.partKey);

      if (!existingForPart) {
        const newAssignment = this.assignmentsRepo.create({
          congregationId,
          weekStartDate,
          eventType: EventType.WEEKEND,
          partKey: part.partKey,
          partOrder: part.partOrder,
          partTitle: part.partTitle,
          partDurationMin: part.durationMin ?? null,
          status: AssignmentStatus.DRAFT,
        });
        await this.assignmentsRepo.save(newAssignment);
        summary.created++;
        overall.partsCreated++;
      } else if (isEmptyTemplate(existingForPart)) {
        existingForPart.partOrder = part.partOrder;
        existingForPart.partTitle = part.partTitle;
        existingForPart.partDurationMin = part.durationMin ?? null;
        await this.assignmentsRepo.save(existingForPart);
        summary.updated++;
        overall.partsUpdated++;
      } else {
        summary.skipped++;
        overall.partsSkipped++;
      }
    }

    return summary;
  }
}
