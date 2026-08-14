import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TasksService } from './tasks.service';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TaskAddresseesService } from './task-addressees.service';
import { AgendaItemsService } from './agenda-items.service';
import type { TaskArea } from '../entities/elder-task.entity';

const AREAS = [
  'ministry',
  'teaching',
  'care',
  'organisation',
  'announcements',
  'accounts',
  'other',
] as const;

const ASSIGNEE_KINDS = ['people', 'service_committee', 'body_of_elders'];

export class UpsertMeetingDto {
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsString() @MaxLength(5) startTime?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) note?: string | null;
  /** A hall from the list, OR a line of one's own — meetings are often at home. */
  @IsOptional() @IsUUID() hallId?: string | null;
  @IsOptional() @IsString() @MaxLength(300) placeText?: string | null;
  @IsOptional() @IsUUID() minuteTakerPublisherId?: string | null;
  @IsOptional() @IsUUID() openingPrayerPublisherId?: string | null;
  @IsOptional() @IsUUID() closingPrayerPublisherId?: string | null;
}

export class UpsertItemDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsIn(AREAS as unknown as string[]) area?: TaskArea;
  @IsOptional() @IsString() @MaxLength(300) sourceText?: string | null;
  @IsOptional() @IsString() @MaxLength(500) sourceUrl?: string | null;
  @IsOptional() @IsUUID() presenterPublisherId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(240) minutes?: number;
  @IsOptional()
  @IsIn(['reviewed', 'carried', 'task'])
  outcome?: 'reviewed' | 'carried' | 'task' | null;
  @IsOptional() @IsString() @MaxLength(4000) outcomeNote?: string | null;
  @IsOptional() @IsUUID() taskId?: string | null;
}

export class UpsertTaskDto {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(8000) details?: string | null;
  @IsOptional() @IsIn(AREAS as unknown as string[]) area?: string;
  @IsOptional() @IsUUID() assigneePublisherId?: string | null;
  @IsOptional() @IsIn(ASSIGNEE_KINDS) assigneeKind?: string;
  /** Named brothers — only meaningful when the kind is «people». */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assigneePublisherIds?: string[];
  @IsOptional() @IsISO8601() dueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(5) dueTime?: string | null;
  /**
   * How far ahead, when the person names a period instead of a date. Turned
   * into a plain date on save — from then on it is an ordinary deadline that
   * can be seen and moved, which is what everybody expects of a date.
   */
  @IsOptional() @IsInt() @Min(1) @Max(60) dueInDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) dueInMonths?: number;
  @IsOptional() @IsUUID() eldersMeetingId?: string | null;
  @IsOptional() @IsIn(['open', 'done']) status?: 'open' | 'done';
}

/**
 * Tasks of the body of elders.
 *
 * Elders and admins only, and refused HERE rather than merely hidden in the
 * app: a hidden tab is a convenience, not a barrier. Every elder sees every
 * task — the body decides together, and a task nobody may read is a task
 * nobody will do.
 */
@Controller('tasks')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN, UserRole.ELDER)
export class TasksController {
  constructor(
    private readonly service: TasksService,
    private readonly addressees: TaskAddresseesService,
    private readonly items: AgendaItemsService,
  ) {}

  // ---- Meetings ---------------------------------------------------------

  @Get('meetings')
  listMeetings(@TenantId() tenantId: string) {
    return this.service.listMeetings(tenantId);
  }

  @Post('meetings')
  async createMeeting(
    @TenantId() tenantId: string,
    @Body() dto: UpsertMeetingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const meeting = await this.service.createMeeting(
      tenantId,
      { ...dto, date: dto.date as string },
      user?.id ?? null,
    );
    // A new meeting takes up whatever was carried over and had nowhere to go:
    // a question left from May must not wait until somebody notices it.
    await this.items.adoptWaiting(tenantId, meeting.id);
    return meeting;
  }

  /**
   * Changing and deleting a meeting belong to whoever builds the agenda.
   *
   * They were open to every elder — an oversight, and the kind that only shows
   * itself the day somebody deletes an evening he did not arrange. The guard
   * on the class admits elders; inside, these three ask for more.
   */
  @Patch('meetings/:id')
  async updateMeeting(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpsertMeetingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.mustBuild(user);
    return this.service.updateMeeting(tenantId, id, dto);
  }

  @Delete('meetings/:id')
  async removeMeeting(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.mustBuild(user);
    return this.service.removeMeeting(tenantId, id);
  }

  private async mustBuild(user: AuthenticatedUser): Promise<void> {
    if (!(await this.items.mayBuild(user))) {
      throw new ForbiddenException('Not allowed');
    }
  }

  // ---- Agenda items -----------------------------------------------------

  @Get('meetings/:id/items')
  listItems(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.items.list(user, id);
  }

  /** Whether THIS person may build the agenda or record what was decided. */
  @Get('meetings/:id/rights')
  async itemRights(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const meeting = await this.service.getMeeting(tenantId, id);
    return {
      mayBuild: await this.items.mayBuild(user),
      mayRecord: meeting ? await this.items.mayRecord(user, meeting) : false,
    };
  }

  @Post('meetings/:id/items')
  createItem(
    @Param('id') id: string,
    @Body() dto: UpsertItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.items.create(user, id, { ...dto, title: dto.title as string });
  }

  @Patch('items/:itemId')
  updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpsertItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.items.update(user, itemId, dto);
  }

  /** «Стал задачей» — the outcome that leaves the meeting with work in hand. */
  @Post('items/:itemId/make-task')
  makeTask(
    @Param('itemId') itemId: string,
    @Body()
    dto: {
      assigneePublisherIds?: string[];
      assigneeKind?: 'people' | 'service_committee' | 'body_of_elders';
      dueDate?: string | null;
      details?: string | null;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.items.makeTask(user, itemId, dto);
  }

  @Post('items/:itemId/move')
  moveItem(
    @Param('itemId') itemId: string,
    @Body() dto: { direction: 'up' | 'down' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.items.move(user, itemId, dto.direction);
  }

  @Delete('items/:itemId')
  removeItem(
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.items.remove(user, itemId);
  }

  /**
   * Approve it, and let the body know.
   *
   * The one act that turns a draft into an agenda: from here every elder sees
   * the items, and word goes out with the day, the hour and the place — and
   * NOT with the items themselves, by the same rule that governs every push
   * here. Approving twice sends word once.
   */
  @Post('meetings/:id/approve')
  async approve(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.mustBuild(user);
    return this.service.approveMeeting(tenantId, id, user);
  }

  /** Close it: what has no outcome travels to the next meeting. */
  @Post('meetings/:id/close')
  async close(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @Body() dto: { toMeetingId?: string | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.mustBuild(user);
    return this.items.carryOver(tenantId, id, dto?.toMeetingId ?? null);
  }

  // ---- The agenda -------------------------------------------------------

  @Get('agenda')
  agenda(@TenantId() tenantId: string, @Query('meetingId') meetingId?: string) {
    const today = new Date().toISOString().slice(0, 10);
    return this.service.agenda(tenantId, meetingId ?? null, today);
  }

  // ---- Tasks ------------------------------------------------------------

  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: 'open' | 'done',
  ) {
    return this.service.listTasks(tenantId, status);
  }

  /**
   * Why a brother must not audit the accounts, per brother.
   *
   * Asked by the form as the choice is made, so the answer arrives before the
   * save rather than as a refusal after it. Two of the three are refusals and
   * one is advice — the caller is told which, and the wording is the app's.
   */
  @Get('audit-objections')
  async auditObjections(
    @TenantId() tenantId: string,
    @Query('publisherIds') publisherIds?: string,
  ) {
    const ids = (publisherIds ?? '').split(',').filter(Boolean);
    const out: Record<string, string> = {};
    for (const id of ids) {
      const reason = await this.addressees.auditObjection(tenantId, id);
      if (reason) out[id] = reason;
    }
    return out;
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: UpsertTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createTask(
      tenantId,
      { ...dto, title: dto.title as string } as never,
      user?.id ?? null,
    );
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpsertTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateTask(
      tenantId,
      id,
      dto as never,
      user?.id ?? null,
    );
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.service.removeTask(tenantId, id);
  }
}
