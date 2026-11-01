import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { refusal } from '../common/errors/refusal';
import { CardMergeService } from './card-merge.service';
import {
  DuplicatesQueryDto,
  MergeDto,
  MergePreviewDto,
} from './dto/card-merge.dto';

/**
 * «Объединить карточки» (1 November 2026). The secretary's work, like
 * marking a card departed; a merge that moves or closes a sign-in is the
 * administrator's (the service refuses it to anyone else).
 */
@Controller('card-merge')
@UseGuards(RolesGuard, ResponsibilityGuard)
@RequireResponsibility(ResponsibilityType.SECRETARY)
export class CardMergeController {
  constructor(private readonly merge: CardMergeService) {}

  /** Cards that may be the person being entered. */
  @Get('duplicates')
  duplicates(@TenantId() tenantId: string, @Query() q: DuplicatesQueryDto) {
    return this.merge.duplicates(tenantId, q);
  }

  /** The merge done and rolled back: exactly what the button would do. */
  @Post('preview')
  preview(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MergePreviewDto,
  ) {
    return this.merge.preview(
      tenantId,
      dto.keptId,
      dto.mergedId,
      { id: user?.id, role: user?.role },
      dto.keepUserId,
    );
  }

  @Post()
  run(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MergeDto,
  ) {
    for (const v of Object.values(dto.fields ?? {})) {
      if (v !== 'kept' && v !== 'merged') {
        throw new BadRequestException(
          refusal('MERGE_CHOICE_MISSING', 'A field is kept or merged.'),
        );
      }
    }
    return this.merge.merge(
      tenantId,
      dto.keptId,
      dto.mergedId,
      {
        fingerprint: dto.fingerprint,
        choices: dto.choices,
        fields: dto.fields,
        keepUserId: dto.keepUserId,
      },
      { id: user?.id, role: user?.role },
    );
  }

  /** The merges into a card, for its history and «Разъединить». */
  @Get('of/:publisherId')
  of(
    @TenantId() tenantId: string,
    @Param('publisherId', ParseUUIDPipe) publisherId: string,
  ) {
    return this.merge.listFor(tenantId, publisherId);
  }

  @Post(':mergeId/undo')
  undo(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('mergeId', ParseUUIDPipe) mergeId: string,
  ) {
    return this.merge.undo(tenantId, mergeId, {
      id: user?.id,
      role: user?.role,
    });
  }
}
