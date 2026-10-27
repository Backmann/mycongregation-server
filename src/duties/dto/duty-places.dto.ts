import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DutyType } from '../../common/enums/duty-type.enum';
import { EventType } from '../../common/enums/event-type.enum';
import { PLACE_CAPABILITIES } from '../duty-places';

export class DutyPlaceDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  id?: string | null;

  @IsEnum(DutyType)
  dutyType!: DutyType;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  customLabel?: string | null;

  @IsInt()
  @Min(1)
  @Max(10)
  count!: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(PLACE_CAPABILITIES)
  capability?: string | null;
}

export class SaveDutyPlacesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => DutyPlaceDto)
  places!: DutyPlaceDto[];
}

export class AssignDutyPlaceDto {
  @IsDateString()
  weekStartDate!: string;

  @IsIn([EventType.MIDWEEK, EventType.WEEKEND])
  eventType!: EventType;

  @IsEnum(DutyType)
  dutyType!: DutyType;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(255)
  customLabel?: string | null;

  @IsInt()
  @Min(0)
  @Max(20)
  ordinal!: number;

  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  publisherId!: string | null;
}
