import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  TERRITORY_CATEGORIES,
  TERRITORY_KINDS,
} from '../../entities/territory.entity';

/** A line across a territory: [lon, lat] points (12 November 2026). */
export class SplitLineDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(500)
  @IsArray({ each: true })
  line!: number[][];
}

export class SplitNoCallDto {
  @IsUUID()
  id!: string;

  /** 0 or 1: the part the address goes to. */
  @IsIn([0, 1])
  part!: 0 | 1;
}

export class SplitDto extends SplitLineDto {
  /** Which part keeps the number and the S-13 history. */
  @IsIn([0, 1])
  keep!: 0 | 1;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  newNumber!: string;

  @IsISO8601()
  updatedAt!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SplitNoCallDto)
  noCalls?: SplitNoCallDto[];
}

export class MergeCheckDto {
  @IsUUID()
  otherId!: string;
}

export class MergeDto extends MergeCheckDto {
  /** The territory whose number stays: this one or the other. */
  @IsUUID()
  keepId!: string;

  @IsISO8601()
  updatedAt!: string;

  @IsISO8601()
  otherUpdatedAt!: string;
}

export class NewCheckDto {
  @IsObject()
  geometry!: Record<string, unknown>;

  @IsOptional()
  @IsIn(TERRITORY_CATEGORIES)
  category?: string;
}

export class CreateTerritoryDto extends NewCheckDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  number!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(120)
  locality?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsIn(TERRITORY_KINDS)
  kind?: string | null;
}
