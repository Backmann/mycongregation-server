import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TERRITORY_KINDS } from '../../entities/territory.entity';
import { TERRITORY_METHODS } from '../../entities/territory-assignment.entity';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The import arrives already read and reconciled by the app: the files never
 * leave the territory servant's computer, only what he confirmed on the
 * reconciliation screen. It comes in batches so no request is large.
 */

export class BoundaryDescriptionDto {
  @IsOptional() @IsString() @MaxLength(400) north?: string;
  @IsOptional() @IsString() @MaxLength(400) east?: string;
  @IsOptional() @IsString() @MaxLength(400) south?: string;
  @IsOptional() @IsString() @MaxLength(400) west?: string;
}

export class ImportBoundaryDto {
  @IsObject()
  geometry!: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => BoundaryDescriptionDto)
  description?: BoundaryDescriptionDto;

  @IsOptional()
  @Matches(DAY)
  validFrom?: string;
}

export class ImportTerritoryDto {
  @IsString()
  @Length(1, 40)
  number!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  locality?: string;

  @IsOptional()
  @IsIn(TERRITORY_KINDS)
  kind?: string;

  @IsObject()
  geometry!: Record<string, unknown>;

  @IsOptional()
  @Matches(DAY)
  lastCompletedOn?: string;
}

export class ImportTerritoriesDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ImportTerritoryDto)
  items!: ImportTerritoryDto[];
}

export class ImportAssignmentDto {
  @IsString()
  @Length(1, 40)
  number!: string;

  @IsOptional()
  @IsUUID()
  publisherId?: string;

  @IsString()
  @Length(1, 160)
  holderName!: string;

  @IsOptional()
  @IsUUID()
  forGroupId?: string;

  @Matches(DAY)
  assignedOn!: string;

  @IsOptional()
  @Matches(DAY)
  completedOn?: string;

  @IsOptional()
  @Matches(DAY)
  returnedOn?: string;

  @IsOptional()
  @IsIn(TERRITORY_METHODS)
  method?: string;
}

export class ImportAssignmentsDto {
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => ImportAssignmentDto)
  items!: ImportAssignmentDto[];
}

export class ImportNoCallDto {
  @IsString()
  @Length(1, 40)
  number!: string;

  @IsString()
  @Length(1, 300)
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  surname?: string;

  @Matches(DAY)
  notedOn!: string;
}

export class ImportNoCallsDto {
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => ImportNoCallDto)
  items!: ImportNoCallDto[];
}
