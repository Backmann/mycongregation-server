import {
  BadRequestException,
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
import { FieldServiceMeetingsService } from './field-service-meetings.service';
import { FieldServicePlannerService } from './field-service-planner.service';
import { SuggestConductorDto } from './dto/suggest-conductor.dto';
import { HallBusyQueryDto } from './dto/hall-busy.dto';
import { HallBusyService } from './hall-busy.service';
import { CreateFieldServiceMeetingDto } from './dto/create-field-service-meeting.dto';
import { UpdateFieldServiceMeetingDto } from './dto/update-field-service-meeting.dto';
import { QueryFieldServiceMeetingsDto } from './dto/query-field-service-meetings.dto';
import { PublishFieldServiceMonthDto } from './dto/publish-field-service-month.dto';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { refusal } from '../common/errors/refusal';

/**
 * Field-ministry meeting schedule. Reading is open to any authenticated
 * member; editing requires the service_overseer responsibility (admins always
 * pass, per the permission matrix).
 */
@Controller('field-service-meetings')
export class FieldServiceMeetingsController {
  constructor(
    private readonly service: FieldServiceMeetingsService,
    private readonly planner: FieldServicePlannerService,
    private readonly hallBusy: HallBusyService,
  ) {}

  /**
   * What else is on in a span of days — the pioneer school, the events —
   * for the planners: the meeting window warns with it, the month page
   * counts the drafts that stand on such a day without a notice.
   */
  @Get('hall-busy')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  hallBusyBetween(
    @TenantId() congregationId: string,
    @Query() q: HallBusyQueryDto,
  ) {
    const from = q.from.slice(0, 10);
    const to = q.to.slice(0, 10);
    const span =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000;
    // The month page asks for its window: a service year and a half at most.
    if (span < 0 || span > 550) {
      throw new BadRequestException(
        refusal(
          'SPAN_INVALID',
          'from must not be after to, and the span at most 550 days.',
        ),
      );
    }
    return this.hallBusy.between(congregationId, from, to);
  }

  /**
   * Who could conduct on a day, best first, each with his reason — the
   * window «Кто ведёт». For the planners: the list says who is away.
   */
  @Get('suggest-conductor')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  suggestConductor(
    @TenantId() congregationId: string,
    @Query() q: SuggestConductorDto,
  ) {
    return this.planner.suggestConductor(congregationId, {
      date: q.date.slice(0, 10),
      serviceGroupId: q.serviceGroupId ?? null,
      conductorRule: q.conductorRule ?? 'rotation',
      excludeMeetingId: q.excludeMeetingId ?? null,
    });
  }

  /**
   * Drafts go only to those who may write them, and only when asked for
   * (`drafts=1`): an app that knows nothing of drafts never receives one.
   */
  @Get()
  async list(
    @TenantId() congregationId: string,
    @Query() query: QueryFieldServiceMeetingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const drafts = query.drafts === '1' && (await this.service.canPlan(user));
    return this.service.list(congregationId, query, drafts);
  }

  /** Announce a month: its drafts become meetings, each person told once. */
  @Post('publish')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  publish(
    @TenantId() congregationId: string,
    @Body() dto: PublishFieldServiceMonthDto,
  ) {
    return this.service.publishMonth(congregationId, dto.year, dto.month);
  }

  @Get('conductor-stats')
  conductorStats(@TenantId() congregationId: string) {
    return this.service.conductorStats(congregationId);
  }

  @Get('topic-history')
  topicHistory(@TenantId() congregationId: string) {
    return this.service.topicHistory(congregationId);
  }

  @Post()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  create(
    @TenantId() congregationId: string,
    @Body() dto: CreateFieldServiceMeetingDto,
  ) {
    return this.service.create(congregationId, dto);
  }

  @Patch(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  update(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFieldServiceMeetingDto,
  ) {
    return this.service.update(congregationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.SERVICE_OVERSEER,
    ResponsibilityType.SERVICE_OVERSEER_ASSISTANT,
  )
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(congregationId, id);
  }
}
