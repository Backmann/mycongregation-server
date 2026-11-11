import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { TerritoriesService } from './territories.service';
import {
  ImportAssignmentsDto,
  ImportBoundaryDto,
  ImportNoCallsDto,
  ImportTerritoriesDto,
} from './dto/import.dto';

/**
 * The territory section (11 November 2026). Who may do what is decided in
 * TerritoryAccessService, not by a guard: whether the service committee
 * sees the section depends on the records having been confirmed, which a
 * guard reading responsibilities alone cannot know.
 */
@Controller('territories')
export class TerritoriesController {
  constructor(private readonly service: TerritoriesService) {}

  @Get('access')
  access(@CurrentUser() user: AuthenticatedUser) {
    return this.service.accessOf(user);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Get('boundary')
  boundary(@CurrentUser() user: AuthenticatedUser) {
    return this.service.boundary(user);
  }

  @Get('checks')
  checks(@CurrentUser() user: AuthenticatedUser) {
    return this.service.checks(user);
  }

  @Post('import/boundary')
  importBoundary(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportBoundaryDto,
  ) {
    return this.service.importBoundary(user, dto);
  }

  @Post('import/territories')
  importTerritories(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportTerritoriesDto,
  ) {
    return this.service.importTerritories(user, dto);
  }

  @Post('import/assignments')
  importAssignments(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportAssignmentsDto,
  ) {
    return this.service.importAssignments(user, dto);
  }

  @Post('import/no-calls')
  importNoCalls(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportNoCallsDto,
  ) {
    return this.service.importNoCalls(user, dto);
  }

  @Post('import/reset')
  @HttpCode(HttpStatus.OK)
  reset(@CurrentUser() user: AuthenticatedUser) {
    return this.service.reset(user);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  verify(@CurrentUser() user: AuthenticatedUser) {
    return this.service.verify(user);
  }

  // Last: a fixed path above must win over the id.
  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(user, id);
  }
}
