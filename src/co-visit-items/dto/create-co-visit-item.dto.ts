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

export const CO_VISIT_ITEM_KINDS = [
  'field_service',
  'lunch',
  'lunch_box',
  'pastoral',
  'pioneers',
  'elders',
  'document_review',
  'other',
] as const;

export const CO_VISIT_PLACE_KINDS = [
  'kingdom_hall',
  'cart_location',
  'custom',
] as const;

export class CreateCoVisitItemDto {
  @IsUUID()
  specialEventId!: string;

  @IsIn(CO_VISIT_ITEM_KINDS)
  kind!: string;

  @IsOptional()
  @IsBoolean()
  forWife?: boolean;

  @IsOptional()
  @IsBoolean()
  withWife?: boolean;

  @IsDateString()
  itemDate!: string;

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
