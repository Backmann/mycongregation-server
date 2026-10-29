import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { refusal } from '../common/errors/refusal';
import { AuxApplicationsService } from './aux-applications.service';
import {
  AuxApplicationDto,
  AuxApproveDto,
  AuxPaperDto,
  AuxStopMineDto,
} from './dto/aux-application.dto';
import { COMMITTEE_SEATS } from '../entities/aux-pioneer-application.entity';
import type { CommitteeSeat } from '../entities/aux-pioneer-application.entity';
import { BadRequestException } from '@nestjs/common';

/**
 * The S-205b application online (29 October 2026). Who may do what is
 * decided in the service against the committee's three places: the
 * applicant his own, the committee and an elder in an open place theirs.
 */
@Controller('aux-applications')
@UseGuards(JwtAuthGuard)
export class AuxApplicationsController {
  constructor(private readonly service: AuxApplicationsService) {}

  /** The applicant's own — and whether the committee can take one now. */
  @Get('mine')
  mine(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.mine(tenantId, user);
  }

  /** Whom the committee lacks — for an admin. */
  @Get('committee')
  async committee(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const state = await this.service.committeeState(tenantId);
    return user.role === UserRole.ADMIN
      ? state
      : { complete: state.complete, missing: [] };
  }

  /** What this reader is to see: the committee all, an elder the open places. */
  @Get()
  list(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.list(tenantId, user);
  }

  /** He ends his own «until cancelled» himself (Lionel, 29 October 2026). */
  @Post('stop-mine')
  stopMine(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AuxStopMineDto,
  ) {
    return this.service.stopOwn(tenantId, user, dto.endMonth);
  }

  /** A publisher's approved applications — for his card; elders and admins. */
  @Get('publisher/:publisherId')
  forPublisher(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('publisherId', ParseUUIDPipe) publisherId: string,
  ) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.ELDER) {
      throw new ForbiddenException(
        refusal('NEEDS_ROLE', 'Elders and admins.', {
          roles: [UserRole.ELDER, UserRole.ADMIN],
        }),
      );
    }
    return this.service.approvedFor(tenantId, publisherId);
  }

  @Get(':id')
  one(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.view(tenantId, user, id);
  }

  @Post()
  apply(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AuxApplicationDto,
  ) {
    return this.service.apply(tenantId, user, dto);
  }

  /** A signed paper, entered by the secretary or an admin. */
  @Post('paper')
  paper(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AuxPaperDto,
  ) {
    return this.service.enterPaper(tenantId, user, dto);
  }

  @Patch(':id')
  change(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AuxApplicationDto,
  ) {
    return this.service.change(tenantId, user, id, dto);
  }

  /** The applicant takes it back. */
  @Delete(':id')
  @HttpCode(204)
  async takeBack(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.takeBack(tenantId, user, id);
  }

  @Post(':id/approve')
  approve(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AuxApproveDto,
  ) {
    return this.service.approve(tenantId, user, id, dto.seat);
  }

  @Post(':id/pass')
  pass(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.pass(tenantId, user, id);
  }

  @Post(':id/open/:seat')
  open(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('seat') seat: string,
  ) {
    if (!(COMMITTEE_SEATS as readonly string[]).includes(seat)) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'Unknown place.', {
          fields: [{ field: 'seat', rules: ['isIn'] }],
        }),
      );
    }
    return this.service.openOther(tenantId, user, id, seat as CommitteeSeat);
  }

  /** A brother of the committee takes it back, quietly. */
  @Post(':id/withdraw')
  @HttpCode(204)
  async withdraw(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.withdraw(tenantId, user, id);
  }
}
