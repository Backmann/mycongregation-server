import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PairPrepService } from './pair-prep.service';
import { AnswerPairPrepDto, ProposePairPrepDto } from './dto/pair-prep.dto';

/**
 * «Договориться о подготовке» — for the two people of a part, about that part
 * only. No role is needed and none would be right: the service checks that
 * the caller IS one of the pair (src/common/mutating-routes-guarded.spec.ts).
 */
@Controller('pair-prep')
export class PairPrepController {
  constructor(private readonly service: PairPrepService) {}

  @Get('mine')
  mine(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.mine(tenantId, user.id);
  }

  @Get(':assignmentId/options')
  options(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.service.options(tenantId, user.id, assignmentId);
  }

  @Post(':assignmentId/propose')
  propose(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: ProposePairPrepDto,
  ) {
    return this.service.propose(tenantId, user.id, assignmentId, dto.key);
  }

  @Post(':assignmentId/answer')
  answer(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: AnswerPairPrepDto,
  ) {
    return this.service.answer(tenantId, user.id, assignmentId, dto.answer);
  }

  @Delete(':assignmentId')
  cancel(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    return this.service.cancel(tenantId, user.id, assignmentId);
  }
}
