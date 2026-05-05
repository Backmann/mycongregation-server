import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';
import { AssignmentStatus } from '../../common/enums/assignment-status.enum';

export class QueryAssignmentDto {
  /** Inclusive lower bound on weekStartDate (ISO date). */
  @IsOptional()
  @IsDateString()
  weekStart?: string;

  /** Exclusive upper bound on weekStartDate. */
  @IsOptional()
  @IsDateString()
  weekEnd?: string;

  @IsOptional()
  @IsEnum(EventType)
  eventType?: EventType;

  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;

  @IsOptional()
  @IsUUID()
  publisherId?: string;

  /** Filter by partKey (exact match). */
  @IsOptional()
  @IsString()
  partKey?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeRemoved?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
