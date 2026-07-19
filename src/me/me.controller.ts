import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { MeService } from './me.service';
import { DataRightsService } from './data-rights.service';
import { EraseAccountDto } from './dto/erase-account.dto';
import { UpdateMyContactsDto } from './dto/update-my-contacts.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

/**
 * Aggregated "my" views for the signed-in member. Open to any authenticated
 * user; everything is scoped to the publisher linked to their login
 * (publisher.userId) and returns an empty list when no publisher is linked.
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly service: MeService,
    private readonly dataRights: DataRightsService,
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
