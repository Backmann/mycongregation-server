import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { MwbImportService } from './mwb-import.service';
import { ProgrammeFilesService } from './programme-files.service';
import { ApplyParsedDto } from './dto/apply-parsed.dto';
import { ProgrammeWeeksQueryDto } from './dto/programme-weeks-query.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Responsibility } from '../entities/responsibility.entity';
import { assertMayWriteSections } from '../common/guards/assignment-section.guard';
import { assertPartInItsMeeting } from '../assignments/part-meeting';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('mwb-import')
export class MwbImportController {
  constructor(
    private readonly service: MwbImportService,
    private readonly files: ProgrammeFilesService,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
  ) {}

  /**
   * «Файлы программы»: week by week, which meetings already have their
   * programme, whether it came from a file, and how far people are named.
   */
  @Get('weeks')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  weeks(
    @TenantId() congregationId: string,
    @Query() q: ProgrammeWeeksQueryDto,
  ) {
    return this.files.weeks(congregationId, { from: q.from, count: q.count });
  }

  /**
   * What the congregation already has, so the screen can say so before
   * anybody picks a file. Elders read it; only admins and elders get here.
   */
  @Get('coverage')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  coverage(@TenantId() congregationId: string) {
    return this.service.coverage(congregationId);
  }

  /**
   * Accepts a workbook parsed on the client. No publication file is
   * uploaded — the payload contains only derived schedule metadata
   * (part keys, titles, durations).
   */
  /**
   * Loading a file writes a meeting's programme, so it takes the right to
   * that meeting (Lionel, 21 November 2026): the workbook — whoever edits
   * the midweek; The Watchtower — whoever edits the weekend; the
   * administrator either. Until then any elder loaded both.
   */
  @Post('apply')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  async apply(
    @TenantId() congregationId: string,
    @Body() dto: ApplyParsedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const sections = this.service.sectionsOf(dto);
    await assertMayWriteSections(this.responsibilities, user, sections);
    // A week is one meeting: a key of the other one in it is refused, or a
    // weekend load wrote midweek parts (review, 21 November 2026).
    assertPartInItsMeeting(
      dto.weeks.flatMap((w, i) =>
        w.parts.map((p) => ({ partKey: p.partKey, eventType: sections[i] })),
      ),
    );
    return this.service.applyParsed(congregationId, dto);
  }
}
