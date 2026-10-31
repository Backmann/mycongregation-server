import {
  BadRequestException,
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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PublishersService } from './publishers.service';
import { AuxiliaryPioneersService } from '../auxiliary-pioneers/auxiliary-pioneers.service';
import { CreatePublisherDto } from './dto/create-publisher.dto';
import { UpdatePublisherDto } from './dto/update-publisher.dto';
import { QueryPublishersDto } from './dto/query-publishers.dto';
import { RemovePublisherDto } from './dto/remove-publisher.dto';
import {
  PastPioneerSpellDto,
  PioneerNoQuotaDto,
} from './dto/past-pioneer-spell.dto';
import { CorrectPioneerKindDto } from './dto/correct-pioneer-kind.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { OverrideStatusDto } from './dto/override-status.dto';
import { GrantAccessDto } from './dto/grant-access.dto';
import { UpdateAccessDto } from './dto/update-access.dto';
import { ResendInviteDto } from './dto/resend-invite.dto';
import {
  publicRosterPage,
  readsEldersOnly,
  withoutEldersOnly,
} from './publisher-privacy';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { CongregationClock } from '../common/congregation-clock.service';
import { refusal } from '../common/errors/refusal';
import { StageAllowed } from '../common/stage';

@Controller('publishers')
@UseGuards(RolesGuard)
export class PublishersController {
  constructor(
    private readonly publishersService: PublishersService,
    private readonly auxiliaryPioneersService: AuxiliaryPioneersService,
    private readonly clock: CongregationClock,
  ) {}

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Patch(':id/status')
  overrideStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OverrideStatusDto,
  ) {
    return this.publishersService.overrideStatus(tenantId, user, id, dto);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Delete(':id/status-override')
  clearOverride(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.clearOverride(tenantId, user, id);
  }

  /**
   * Directory list, three access tiers:
   *  - privileged (admins, elders, members granted private-data access):
   *    full directory with filters;
   *  - holders of ANY responsibility (schedule/duty/cleaning planners, who
   *    may be ministerial servants): the FULL congregation, but redacted to
   *    the name-and-scheduling roster — their pickers need every candidate,
   *    not just their own group, yet no private contact data;
   *  - regular publishers: ONLY their own service group, redacted. Unlinked
   *    users get an empty page.
   */
  @Get()
  async findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryPublishersDto,
  ) {
    const privileged = await this.publishersService.resolvePrivateAccess(
      tenantId,
      user,
    );
    if (!privileged) {
      query.includeRemoved = false;
      const planner = await this.publishersService.holdsAnyResponsibility(
        tenantId,
        user.id,
      );
      if (!planner) {
        const ownGroupId = await this.publishersService.findOwnServiceGroupId(
          tenantId,
          user.id,
        );
        if (!ownGroupId) {
          return {
            data: [],
            total: 0,
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
          };
        }
        query.serviceGroupId = ownGroupId;
      }
    }
    const result = await this.publishersService.findAll(tenantId, query);
    if (privileged) {
      return readsEldersOnly(user.role)
        ? result
        : { ...result, data: result.data.map(withoutEldersOnly) };
    }
    return publicRosterPage(
      result,
      await this.publishersService.overseenServiceGroupIds(tenantId, user.id),
    );
  }

  /**
   * Names-only roster (id + displayName) for resolving assignment names on
   * schedules. Open to any authenticated member — these names appear on the
   * posted schedules anyway. Must stay above the ':id' route.
   */
  // The stage screen reads this (common/stage.ts).
  @StageAllowed()
  @Get('roster')
  roster(@TenantId() tenantId: string) {
    return this.publishersService.roster(tenantId);
  }

  /**
   * WHY a publisher's badge says what it says — the months weighed, from when
   * he is counted, and when a sixth silent month would fall.
   *
   * Admins and elders only, like the status itself (28 October 2026). It was
   * gated like the card, so a brother given access to private data — from
   * whose card the status is stripped — could read it here: the answer
   * carries the status and the silent months behind it. The two screens that
   * ask (a publisher's history, a group's reports) ask only for elders.
   *
   * Must stay ABOVE ':id' or the router reads «status-explained» as an id.
   */
  @Roles(UserRole.ADMIN, UserRole.ELDER)
  @Get(':id/status-explained')
  async explainStatus(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.explainStatus(tenantId, id);
  }

  @Get(':id')
  async findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const privileged = await this.publishersService.resolvePrivateAccess(
      tenantId,
      user,
    );
    if (!privileged) {
      throw new ForbiddenException(
        refusal(
          'PUBLISHER_CARD_CLOSED',
          'Publisher cards are visible to admins, elders, and members granted ' +
            'access to private data.',
        ),
      );
    }
    const publisher = await this.publishersService.findOne(tenantId, id);
    const lastEditedByName = await this.publishersService.resolveEditorName(
      tenantId,
      publisher.lastEditedById,
    );
    // Who vouched for the contacts — themselves, or the secretary for them.
    const contactsConfirmedByName =
      await this.publishersService.resolveEditorName(
        tenantId,
        publisher.contactsConfirmedByUserId,
      );
    // The computed status (active/irregular/inactive) is pastoral information
    // for elders — strip it for anyone who is not an admin or elder (e.g. a
    // trusted member with canViewPrivateData), so it never leaks in the
    // response, not even to the publisher themselves.
    const canSeeStatus =
      user.role === UserRole.ADMIN || user.role === UserRole.ELDER;
    const result = { ...publisher, lastEditedByName, contactsConfirmedByName };
    if (!canSeeStatus) {
      delete (result as { status?: unknown }).status;
      // The circumstances the annual report asks about are pastoral too, and
      // a good deal more personal than a service status: whether someone is
      // deaf, blind or in prison is nobody's business but the elders'. Absent
      // from the response entirely rather than sent as false, so no reader can
      // tell "not flagged" from "not allowed to know".
      delete (result as { isDeaf?: unknown }).isDeaf;
      delete (result as { isBlind?: unknown }).isBlind;
      delete (result as { isImprisoned?: unknown }).isImprisoned;
    }
    // Flag whether the publisher serves as an auxiliary pioneer this month, so
    // the card can show an elder a badge. No hour goal is exposed here.
    const isAuxiliaryPioneerNow =
      await this.auxiliaryPioneersService.isActiveAuxiliaryPioneer(
        tenantId,
        publisher.id,
        await this.clock.todayFor(tenantId),
      );
    return { ...result, isAuxiliaryPioneerNow };
  }

  @Roles(UserRole.ADMIN)
  @Get(':id/access')
  getAccess(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.getAccess(tenantId, id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/access')
  grantAccess(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantAccessDto,
  ) {
    return this.publishersService.grantAccess(tenantId, id, dto, user);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/access')
  updateAccess(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAccessDto,
  ) {
    return this.publishersService.updateAccess(tenantId, id, dto, user);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/access/resend-invite')
  resendInvite(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResendInviteDto,
  ) {
    return this.publishersService.resendInvite(tenantId, id, {
      post: dto.post,
    });
  }

  /**
   * Call back an invitation that has not been used. Admin only, like the rest.
   *
   * The comment said so and the decorator was missing: RolesGuard lets a
   * route with no roles through, so any signed-in member could cancel
   * anyone's unused invitation (found by the rights audit, 24 September).
   * mutating-routes-guarded.spec.ts now fails on such a route.
   */
  @Roles(UserRole.ADMIN)
  @Post(':id/access/revoke-invite')
  revokeInvite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @TenantId() tenantId: string,
  ) {
    return this.publishersService.revokeInvite(tenantId, id);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreatePublisherDto) {
    return this.publishersService.create(tenantId, dto);
  }

  /** The yearly contact check done on someone's behalf. */
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Post(':id/contacts/confirm')
  @HttpCode(200)
  confirmContacts(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.confirmContacts(tenantId, id, user?.id);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublisherDto,
  ) {
    return this.publishersService.update(tenantId, id, dto, user?.id);
  }

  /** The pioneer kind was written down wrong — corrected for all its months. */
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Post(':id/pioneer-kind-correction')
  @HttpCode(200)
  correctPioneerKind(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectPioneerKindDto,
  ) {
    return this.publishersService.correctPioneerKind(
      tenantId,
      id,
      dto.pioneerType,
      user?.id,
    );
  }

  /**
   * The pioneer history on the card (30 October 2026): every spell of
   * regular, special and missionary pioneering and the months in all. Seen
   * by whoever may open the card; written by the secretary.
   */
  @Get(':id/pioneer-history')
  async pioneerHistory(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const privileged = await this.publishersService.resolvePrivateAccess(
      tenantId,
      user,
    );
    if (!privileged) {
      throw new ForbiddenException(
        refusal(
          'PUBLISHER_CARD_CLOSED',
          'Publisher cards are visible to admins, elders, and members granted ' +
            'access to private data.',
        ),
      );
    }
    return this.publishersService.pioneerHistory(tenantId, id);
  }

  /** Point 9: serving without the hours requirement, from the decision. */
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Put(':id/pioneer-no-quota')
  setPioneerNoQuota(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PioneerNoQuotaDto,
  ) {
    return this.publishersService.setPioneerNoQuota(
      tenantId,
      id,
      dto.decidedOn,
      user?.id,
    );
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Delete(':id/pioneer-no-quota')
  endPioneerNoQuota(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.endPioneerNoQuota(tenantId, id, user?.id);
  }

  /** What ending his pioneering with this last month would meet. */
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Get(':id/pioneer-end-impact')
  pioneerEndImpact(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lastMonth') lastMonth: string,
  ) {
    if (!/^\d{4}-\d{2}$/.test(lastMonth ?? '')) {
      throw new BadRequestException(
        refusal('INVALID_FIELD', 'lastMonth is YYYY-MM', {
          fields: [{ field: 'lastMonth', rules: ['matches'] }],
        }),
      );
    }
    return this.publishersService.pioneerEndImpact(tenantId, id, lastMonth);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Post(':id/pioneer-history')
  addPastPioneerSpell(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PastPioneerSpellDto,
  ) {
    return this.publishersService.addPastPioneerSpell(
      tenantId,
      id,
      dto,
      user?.id,
    );
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Patch(':id/pioneer-history/:spellId')
  updatePastPioneerSpell(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('spellId', ParseUUIDPipe) spellId: string,
    @Body() dto: PastPioneerSpellDto,
  ) {
    return this.publishersService.updatePastPioneerSpell(
      tenantId,
      id,
      spellId,
      dto,
      user?.id,
    );
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Delete(':id/pioneer-history/:spellId')
  removePastPioneerSpell(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('spellId', ParseUUIDPipe) spellId: string,
  ) {
    return this.publishersService.removePastPioneerSpell(
      tenantId,
      id,
      spellId,
      user?.id,
    );
  }

  /** What marking the card departed would take with it (23 October 2026). */
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Get(':id/removal-impact')
  removalImpact(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.removalImpact(tenantId, id, user?.id);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Post(':id/remove')
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemovePublisherDto,
  ) {
    return this.publishersService.remove(tenantId, id, dto, user?.id);
  }

  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(ResponsibilityType.SECRETARY)
  @Post(':id/restore')
  restore(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.publishersService.restore(tenantId, id, user?.id);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  purge(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.publishersService.purge(tenantId, id);
  }
}
