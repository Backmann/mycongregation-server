import { Controller, Post, UseGuards } from '@nestjs/common';
import { PublishersService } from '../publishers/publishers.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';

@Controller('admin')
@UseGuards(RolesGuard)
export class AdminController {
  constructor(private readonly publishersService: PublishersService) {}

  /**
   * Manually trigger status recompute across every active publisher.
   * Useful for one-off backfills (e.g. just after Phase C3 deployment) and
   * for admins who want to refresh statuses without waiting for the cron.
   *
   * Returns:
   *   {
   *     processed,            // total publishers iterated
   *     updated,              // status actually changed
   *     unchanged,            // computed status matched stored
   *     skipped,              // statusManuallyOverridden=true
   *     errors,               // per-publisher failures
   *     durationMs            // wall-clock for the run
   *   }
   */
  @Roles(UserRole.ADMIN)
  @Post('recompute-statuses')
  async recomputeStatuses() {
    return this.publishersService.recomputeAllStatuses();
  }
}
