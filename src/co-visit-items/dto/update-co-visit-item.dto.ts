import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CO_VISIT_ITEM_KINDS,
  CO_VISIT_PLACE_KINDS,
} from './create-co-visit-item.dto';

export class UpdateCoVisitItemDto {
  @IsOptional()
  @IsIn(CO_VISIT_ITEM_KINDS)
  kind?: string;

  @IsOptional()
  @IsBoolean()
  forWife?: boolean;

  @IsOptional()
  @IsDateString()
  itemDate?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be "HH:MM"',
  })
  startTime?: string | null;

  @IsOptional()
  @IsIn(CO_VISIT_PLACE_KINDS)
  placeKind?: string | null;

  @IsOptional()
  @IsUUID()
  cartLocationId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  placeText?: string | null;

  @IsOptional()
  @IsUUID()
  assigneePublisherId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  assigneeText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
