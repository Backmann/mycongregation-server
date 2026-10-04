import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ReadinessService } from './readiness.service';
import { QueryReadinessDto } from './dto/query-readiness.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { Responsibility } from '../entities/responsibility.entity';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import {
  PROGRAMME_READINESS_READERS,
  withoutProgramme,
} from './programme-readers';

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
 * to read them. He gets those figures and nothing about the programme — see
 * programme-readers.ts.
 */
@Controller('readiness')
export class ReadinessController {
  constructor(
    private readonly service: ReadinessService,
    @InjectRepository(Responsibility)
    private readonly responsibilities: Repository<Responsibility>,
  ) {}

  @Get()
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.LIFE_MINISTRY_OVERSEER,
    ResponsibilityType.BODY_COORDINATOR,
    ResponsibilityType.DUTIES_COORDINATOR,
  )
  async list(
    @TenantId() congregationId: string,
    @Query() query: QueryReadinessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const weeks = await this.service.forRange(
      congregationId,
      query.weekStart,
      query.weekEnd,
    );
    if (user.role === UserRole.ADMIN) return weeks;
    const assembles = await this.responsibilities.count({
      where: {
        congregationId: user.congregationId,
        userId: user.id,
        type: In([...PROGRAMME_READINESS_READERS]),
      },
    });
    return assembles > 0 ? weeks : withoutProgramme(weeks);
  }
}
