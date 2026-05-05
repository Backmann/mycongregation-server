import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';
import { AssignmentStatus } from '../../common/enums/assignment-status.enum';

export class CreateAssignmentDto {
  @IsDateString()
  weekStartDate!: string;

  @IsEnum(EventType)
  eventType!: EventType;

  @IsString()
  @Length(1, 64)
  partKey!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  partOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  partTitle?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  partDurationMin?: number;

  @IsOptional()
  @IsUUID()
  publisherId?: string;

  @IsOptional()
  @IsUUID()
  assistantPublisherId?: string;

  @IsOptional()
  @IsEnum(AssignmentStatus)
  status?: AssignmentStatus;

  @IsOptional()
  @IsString()
  notes?: string;
}
