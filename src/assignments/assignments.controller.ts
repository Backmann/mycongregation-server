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
  create(@TenantId() congregationId: string, @Body() dto: CreateAssignmentDto) {
    return this.service.create(congregationId, dto);
  }

  @Post('bulk')
  @UseGuards(AssignmentSectionGuard)
  bulkCreate(
    @TenantId() congregationId: string,
    @Body() dto: BulkCreateAssignmentDto,
  ) {
    return this.service.bulkCreate(congregationId, dto.assignments);
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
  ) {
    return this.service.update(congregationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(AssignmentSectionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(congregationId, id);
  }

  @Post(':id/restore')
  @UseGuards(AssignmentSectionGuard)
  restore(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.restore(congregationId, id);
  }
}
