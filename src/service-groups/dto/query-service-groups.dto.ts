import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { queryBool } from '../../common/query-bool';
import { Transform, Type } from 'class-transformer';

export enum ServiceGroupSortField {
  NAME = 'name',
  CREATED_AT = 'createdAt',
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class QueryServiceGroupsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(queryBool)
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
  @IsEnum(ServiceGroupSortField)
  sortBy?: ServiceGroupSortField = ServiceGroupSortField.NAME;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.ASC;
}
