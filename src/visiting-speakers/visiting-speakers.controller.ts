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
import { VisitingSpeakersService } from './visiting-speakers.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateVisitingSpeakerDto } from './dto/create-visiting-speaker.dto';
import { UpdateVisitingSpeakerDto } from './dto/update-visiting-speaker.dto';
import { MarkDistinctDto } from './dto/mark-distinct.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';

/**
 * Directory of visiting (incoming) public speakers. Reading is open to any
 * authenticated member; writing is limited to admins and the
 * public_talk_coordinator (enforced in the service).
 */
@Controller('visiting-speakers')
export class VisitingSpeakersController {
  constructor(private readonly service: VisitingSpeakersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listFor(user);
  }

  /**
   * Пары «это разные братья». Объявлено ДО `:id`, иначе путь приняли бы за
   * номер карточки.
   */
  @Get('distinct-pairs')
  listDistinct(@TenantId() tenantId: string) {
    return this.service.listDistinct(tenantId);
  }

  @Post('distinct-pairs')
  @HttpCode(HttpStatus.NO_CONTENT)
  markDistinct(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MarkDistinctDto,
  ) {
    return this.service.markDistinct(tenantId, user, dto.firstId, dto.secondId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getFor(user, id);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @Body() dto: CreateVisitingSpeakerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(tenantId, dto, user);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVisitingSpeakerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(tenantId, id, dto, user);
  }

  /**
   * Два имени — один брат. Оставшуюся карточку указывает человек: тёзки
   * бывают, и решать за него нельзя.
   */
  @Post(':keepId/merge/:mergeId')
  merge(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('keepId', ParseUUIDPipe) keepId: string,
    @Param('mergeId', ParseUUIDPipe) mergeId: string,
  ) {
    return this.service.merge(tenantId, user, keepId, mergeId);
  }

  /** Карточки, объединённые с этой. */
  @Get(':id/merged')
  listMerged(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.listMerged(tenantId, id);
  }

  /** Это были разные братья: вернуть объединённой карточке её историю. */
  @Post(':keepId/unmerge/:mergedId')
  unmerge(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('keepId', ParseUUIDPipe) keepId: string,
    @Param('mergedId', ParseUUIDPipe) mergedId: string,
  ) {
    return this.service.unmerge(tenantId, user, keepId, mergedId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(tenantId, id, user);
  }
}
