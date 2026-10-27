import {
  BadRequestException,
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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DutiesService } from './duties.service';
import { QueryDutiesDto } from './dto/query-duties.dto';
import { GenerateWeekDutiesDto } from './dto/generate-week-duties.dto';
import { AssignDutyDto } from './dto/assign-duty.dto';
import { CreateCustomDutyDto } from './dto/create-custom-duty.dto';
import { SetMicrophoneSlotsDto } from './dto/set-microphone-slots.dto';
import { TenantId } from '../common/decorators/tenant-id.decorator';
import { RequireResponsibility } from '../common/decorators/require-responsibility.decorator';
import { ResponsibilityGuard } from '../common/guards/responsibility.guard';
import { ResponsibilityType } from '../common/enums/responsibility-type.enum';
import { RenamePlaceDto } from './dto/rename-place.dto';
import { MovePlaceDto } from './dto/move-place.dto';
import { refusal } from '../common/errors/refusal';
import { AssignDutyPlaceDto, SaveDutyPlacesDto } from './dto/duty-places.dto';
import type { PlaceKind, PlaceSpec } from './duty-places';

/**
 * Meeting duties. Reading is open to any authenticated member; editing requires
 * the duties_coordinator OR body_coordinator responsibility (the body
 * coordinator / совет старейшин edits duties too; admins always pass).
 */
@Controller('duties')
export class DutiesController {
  constructor(private readonly service: DutiesService) {}

  @Get()
  list(@TenantId() congregationId: string, @Query() query: QueryDutiesDto) {
    return this.service.list(congregationId, query);
  }

  /** Every meeting of a month with its places, and who carries how much. */
  @Get('month')
  month(@TenantId() congregationId: string, @Query('month') month: string) {
    return this.service.month(congregationId, month);
  }

  /** The congregation's places at one kind of meeting. */
  @Get('places/:kind')
  places(@TenantId() congregationId: string, @Param('kind') kind: string) {
    return this.service.getPlaces(congregationId, kindOf(kind));
  }

  /** What saving these places would change on the sheets still ahead. */
  @Post('places/:kind/preview')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  previewPlaces(
    @TenantId() congregationId: string,
    @Param('kind') kind: string,
    @Body() dto: SaveDutyPlacesDto,
  ) {
    return this.service.changePlaces(
      congregationId,
      kindOf(kind),
      dto.places as PlaceSpec[],
      false,
    );
  }

  @Put('places/:kind')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  savePlaces(
    @TenantId() congregationId: string,
    @Param('kind') kind: string,
    @Body() dto: SaveDutyPlacesDto,
  ) {
    return this.service.changePlaces(
      congregationId,
      kindOf(kind),
      dto.places as PlaceSpec[],
      true,
    );
  }

  /** A cell of the month table: a place of a meeting that may have no sheet yet. */
  @Post('assign-place')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  assignPlace(
    @TenantId() congregationId: string,
    @Body() dto: AssignDutyPlaceDto,
  ) {
    return this.service.assignPlace(congregationId, {
      ...dto,
      publisherId: dto.publisherId ?? null,
    });
  }

  @Post('generate')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  generate(
    @TenantId() congregationId: string,
    @Body() dto: GenerateWeekDutiesDto,
  ) {
    return this.service.generateWeek(congregationId, dto);
  }

  @Post('custom')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  createCustom(
    @TenantId() congregationId: string,
    @Body() dto: CreateCustomDutyDto,
  ) {
    return this.service.createCustom(congregationId, dto);
  }

  @Patch('microphone-slots')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  setMicrophoneSlots(
    @TenantId() congregationId: string,
    @Body() dto: SetMicrophoneSlotsDto,
  ) {
    return this.service.setMicrophoneSlots(congregationId, dto.microphoneSlots);
  }

  @Patch(':id/assign')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  assign(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDutyDto,
  ) {
    return this.service.assign(congregationId, id, dto);
  }

  /**
   * Rename a place — every row of it. Own places only: a predefined duty takes
   * its name from the translations, and writing over it would break the
   * language for everybody else.
   */
  @Patch(':id/label')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  renamePlace(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenamePlaceDto,
  ) {
    return this.service.renamePlace(congregationId, id, dto.customLabel);
  }

  /** Move a place up or down the sheet; its rows move together. */
  @Patch(':id/move')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  movePlace(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MovePlaceDto,
  ) {
    return this.service.movePlace(congregationId, id, dto.direction);
  }

  /** Remove a place with everybody standing at it — the bin takes off one. */
  @Delete(':id/place')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  removePlace(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removePlace(congregationId, id);
  }

  @Delete(':id')
  @UseGuards(ResponsibilityGuard)
  @RequireResponsibility(
    ResponsibilityType.DUTIES_COORDINATOR,
    ResponsibilityType.BODY_COORDINATOR,
  )
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @TenantId() congregationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.remove(congregationId, id);
  }
}

function kindOf(kind: string): PlaceKind {
  if (kind === 'midweek' || kind === 'weekend') return kind;
  throw new BadRequestException(
    refusal('DUTY_PLACES_INVALID', 'Kind must be midweek or weekend.'),
  );
}
