import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PublisherAppointment } from '../../common/enums/publisher-appointment.enum';
import { PioneerType } from '../../common/enums/pioneer-type.enum';

export enum PublisherSortField {
  LAST_NAME = 'lastName',
  FIRST_NAME = 'firstName',
  BAPTISM_DATE = 'baptismDate',
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

export class QueryPublishersDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  familyId?: string;

  @IsOptional()
  @IsUUID()
  serviceGroupId?: string;

  @IsOptional()
  @IsEnum(PublisherAppointment)
  appointment?: PublisherAppointment;

  @IsOptional()
  @IsEnum(PioneerType)
  pioneerType?: PioneerType;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

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
  @IsEnum(PublisherSortField)
  sortBy?: PublisherSortField = PublisherSortField.LAST_NAME;

  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.ASC;
}
