import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum FamilySortField {
  NAME = 'name',
  CREATED_AT = 'createdAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : undefined;

export class QueryFamiliesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeRemoved?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsEnum(FamilySortField)
  sortBy?: FamilySortField = FamilySortField.NAME;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.ASC;
}
