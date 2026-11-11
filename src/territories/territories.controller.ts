import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../auth/decorators/current-user.decorator';
import { TerritoriesService } from './territories.service';
import { TerritoryAssignmentsService } from './territory-assignments.service';
import {
  AssignTerritoryDto,
  CompleteAssignmentDto,
  EditAssignmentDto,
  ExtendAssignmentDto,
  ReturnAssignmentDto,
} from './dto/assignment.dto';
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
  constructor(
    private readonly service: TerritoriesService,
    private readonly given: TerritoryAssignmentsService,
  ) {}

  /** The door: what the user may open, and the territories he has a part in. */
  @Get('access')
  async access(@CurrentUser() user: AuthenticatedUser) {
    const [a, mine] = await Promise.all([
      this.service.accessOf(user),
      this.given.mine(user),
    ]);
    return {
      ...a,
      mine: mine.map((t) => ({
        id: t.id,
        number: t.number,
        dueOn: t.assignment.dueOn,
        mine: t.assignment.mine,
        forGroupName: t.assignment.forGroupName,
      })),
    };
  }

  /** The holder's and his group's territories, with their shapes. */
  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.given.mine(user);
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

  // ---- giving out and taking back ----

  @Get(':id/candidates')
  candidates(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.given.candidates(user, id);
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTerritoryDto,
  ) {
    return this.given.assign(user, id, dto);
  }

  @Post('assignments/:id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteAssignmentDto,
  ) {
    return this.given.complete(user, id, dto);
  }

  @Post('assignments/:id/return')
  @HttpCode(HttpStatus.OK)
  giveBack(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnAssignmentDto,
  ) {
    return this.given.giveBack(user, id, dto);
  }

  @Post('assignments/:id/extend')
  @HttpCode(HttpStatus.OK)
  extend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendAssignmentDto,
  ) {
    return this.given.extend(user, id, dto);
  }

  @Patch('assignments/:id')
  edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditAssignmentDto,
  ) {
    return this.given.edit(user, id, dto);
  }

  @Delete('assignments/:id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.given.remove(user, id);
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
