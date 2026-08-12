import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { MeService } from './me.service';
import { DataRightsService } from './data-rights.service';
import { EraseAccountDto } from './dto/erase-account.dto';
import { UpdateMyContactsDto } from './dto/update-my-contacts.dto';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { TasksService } from '../tasks/tasks.service';

/**
 * Aggregated "my" views for the signed-in member. Open to any authenticated
 * user; everything is scoped to the publisher linked to their login
 * (publisher.userId) and returns an empty list when no publisher is linked.
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly service: MeService,
    private readonly notifications: NotificationsService,
    private readonly dataRights: DataRightsService,
    private readonly tasks: TasksService,
  ) {}

  @Get('assignments')
  myAssignments(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.myAssignments(tenantId, user.id);
  }

  @Get('weeks')
  myWeeks(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.myWeeks(tenantId, user.id);
  }

  /** A publisher updating their own contacts (phone, e-mail, address). */
  @Patch('publisher/contacts')
  updateMyContacts(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMyContactsDto,
  ) {
    return this.service.updateMyContacts(tenantId, user.id, dto);
  }

  /** "My contacts are still correct" — the yearly check, without edits. */
  @Post('publisher/contacts/confirm')
  @HttpCode(200)
  confirmMyContacts(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.confirmMyContacts(tenantId, user.id);
  }

  @Get('publisher')
  myPublisher(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.myPublisher(tenantId, user.id);
  }

  /**
   * The open tasks put on ME — and nothing else.
   *
   * The tasks section belongs to the elders, and that stays: a brother has no
   * business reading what the body is working through. But a task given to him
   * and invisible to him is not a task, it is a telephone call somebody still
   * has to make. This route is the narrow answer: his own, whichever way they
   * were addressed, and refused by the server to anybody asking about another.
   */
  @Get('tasks')
  async myTasks(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const me = await this.service.myPublisher(tenantId, user.id);
    const card = (me as { publisher?: { id?: string } })?.publisher;
    if (!card?.id) return [];
    return this.tasks.myTasks(tenantId, card.id);
  }

  /**
   * What this person hears about, and the switch for each. Personal settings,
   * so they hang off /me and need no role: everyone decides for themselves.
   */
  @Get('notification-preferences')
  notificationPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.getPreferences(user.id);
  }

  @Patch('notification-preferences')
  setNotificationPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notifications.setPreference(user.id, dto.category, dto.enabled);
  }

  @Get('export')
  exportMyData(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dataRights.exportMyData(tenantId, user.id);
  }

  @Post('erase')
  @HttpCode(200)
  eraseMyAccount(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EraseAccountDto,
  ) {
    return this.dataRights.eraseMyAccount(tenantId, user.id, dto.password);
  }
}
