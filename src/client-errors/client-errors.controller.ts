import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { ClientErrorsService } from './client-errors.service';
import { ReportClientErrorDto } from './dto/report-client-error.dto';

/**
 * Failures met in the app (10 November 2026): the app reports them here, an
 * administrator reads them on «Сбои».
 */
@Controller('client-errors')
@UseGuards(RolesGuard)
export class ClientErrorsController {
  constructor(private readonly errors: ClientErrorsService) {}

  /**
   * Open to anyone — the sign-in screen can fail too — so it is held to a
   * few reports a minute from one place, and every field is bounded.
   */
  @Public()
  @Throttle({
    short: { limit: 10, ttl: 60_000 },
    long: { limit: 30, ttl: 600_000 },
  })
  @Post()
  @HttpCode(204)
  async report(@Body() dto: ReportClientErrorDto): Promise<void> {
    await this.errors.record(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  list() {
    return this.errors.list();
  }
}
