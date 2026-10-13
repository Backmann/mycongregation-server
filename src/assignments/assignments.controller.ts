import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { SwapPublicTalkDto } from './dto/swap-public-talk.dto';
import { QueryAssignmentDto } from './dto/query-assignment.dto';
import { BulkCreateAssignmentDto } from './dto/bulk-create-assignment.dto';
import { PublishAssignmentsDto } from './dto/publish-assignments.dto';
import { RestoreAssignmentDto } from './dto/restore-assignment.dto';
import { ProgrammeLocksQueryDto } from './dto/programme-locks-query.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AssignmentSectionGuard } from '../common/guards/assignment-section.guard';

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  @Get()
  list(
    @TenantId() congregationId: string,
    @Query() query: QueryAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(congregationId, query, user);
  }

  /** Published weeks for the schedule week-navigator drawer. */
  @Get('weeks')
  publishedWeeks(@TenantId() congregationId: string) {
    return this.service.listPublishedWeeks(congregationId);
  }

  /**
   * How the week's meetings stand: the day each was held, the last day its
   * programme may change, and whether it is already the record — plus
   * whether this reader may correct it afterwards (13 October 2026). The
   * screens draw from this rather than counting days themselves, so the app
   * and the server can never disagree about a week.
   */
  @Get('locks')
  locks(
    @TenantId() congregationId: string,
    @Query() query: ProgrammeLocksQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.locksOfWeek(congregationId, query.weekStart, user);
  }

  @Get(':id')
  getById(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getById(congregationId, id, user);
  }

  @Post()
  @UseGuards(AssignmentSectionGuard)
  create(
    @TenantId() congregationId: string,
    @Body() dto: CreateAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(congregationId, dto, user);
  }

  @Post('bulk')
  @UseGuards(AssignmentSectionGuard)
  bulkCreate(
    @TenantId() congregationId: string,
    @Body() dto: BulkCreateAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.bulkCreate(congregationId, dto.assignments, {
      retroactive: dto.retroactive,
      user,
    });
  }

  @Post('publish')
  @UseGuards(AssignmentSectionGuard)
  publish(
    @TenantId() congregationId: string,
    @Body() dto: PublishAssignmentsDto,
  ) {
    return this.service.publishMeeting(
      congregationId,
      dto.weekStartDate,
      dto.eventType,
      dto.notify,
    );
  }

  /**
   * Who an edit to a published meeting concerns, before anything is sent.
   * Behind the same guard as the edit itself: it names people. A POST only
   * because that guard reads the section from the body; it changes nothing.
   */
  @Post('pending-notice')
  @HttpCode(200)
  @UseGuards(AssignmentSectionGuard)
  pendingNotice(
    @TenantId() congregationId: string,
    @Body() dto: PublishAssignmentsDto,
  ) {
    return this.service.pendingNotice(
      congregationId,
      dto.weekStartDate,
      dto.eventType,
    );
  }

  @Post('notify-changes')
  @UseGuards(AssignmentSectionGuard)
  notifyChanges(
    @TenantId() congregationId: string,
    @Body() dto: PublishAssignmentsDto,
  ) {
    return this.service.notifyChanges(
      congregationId,
      dto.weekStartDate,
      dto.eventType,
    );
  }

  /**
   * Swap or move the weekend public-talk contents between two weeks (the
   * booked speaker arrived on a different date). Guarded by the weekend
   * section rights via eventType in the body.
   */
  @Post('public-talk/swap')
  @UseGuards(AssignmentSectionGuard)
  swapPublicTalk(
    @TenantId() congregationId: string,
    @Body() dto: SwapPublicTalkDto,
  ) {
    return this.service.swapPublicTalk(congregationId, dto);
  }

  @Patch(':id')
  @UseGuards(AssignmentSectionGuard)
  update(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(congregationId, id, dto, user);
  }

  @Delete(':id')
  @UseGuards(AssignmentSectionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    /** «1» — a correction after the fact (DELETE carries no body). */
    @Query('retroactive') retroactive?: string,
  ) {
    return this.service.remove(congregationId, id, {
      retroactive: retroactive === '1',
      user,
    });
  }

  @Post(':id/restore')
  @UseGuards(AssignmentSectionGuard)
  restore(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RestoreAssignmentDto,
  ) {
    return this.service.restore(congregationId, id, {
      retroactive: body?.retroactive === true,
      user,
    });
  }
}
