import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One business to add (13 November 2026): a place of the map by its id
 * (the rest is taken from the map), or a name, a kind and maybe a point.
 */
export class NewBusinessDto {
  @IsOptional()
  @Matches(/^\d{1,19}$/)
  osmId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  kind?: string;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon?: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;
}

export class AddBusinessesDto {
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => NewBusinessDto)
  items!: NewBusinessDto[];
}

/** A correction: only the fields sent change. */
export class EditBusinessDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Matches(/\S/)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  kind?: string;

  /** A point inside the territory; null with lat null takes it away. */
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number | null;
}

export class MarkBusinessDto {
  /** Null clears the mark. */
  @IsOptional()
  @IsIn(['visited', 'later'])
  state!: 'visited' | 'later' | null;
}
