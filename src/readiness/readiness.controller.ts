import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReadinessService } from './readiness.service';
import { QueryReadinessDto } from './dto/query-readiness.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';

/**
 * How far along each day's programme is.
 *
 * OPEN ONLY TO THOSE WHO ASSEMBLE IT, and to admins. Not because the figures
 * are secret, but because they would otherwise mean two different things: a
 * reader who is not an editor sees only the published programme, so the same
 * day would be «ready» for one person and «short of three» for another. Here
 * the numbers count drafts too, and that is only safe among the people the
 * drafts already belong to.
 *
 * The duties coordinator is admitted as well: he does not assemble the
 * programme, but the duty figures beside it are his, and he has nowhere else
 * to read them.
 */
@Controller('readiness')
export class ReadinessController {
  constructor(private readonly service: ReadinessService) {}

  @Get()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.DUTIES_COORDINATOR,
  )
  list(@TenantId() congregationId: string, @Query() query: QueryReadinessDto) {
    return this.service.forRange(
      congregationId,
      query.weekStart,
      query.weekEnd,
    );
  }
}
