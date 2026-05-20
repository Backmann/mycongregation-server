import { IsIn, IsOptional, IsDateString } from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';

export class QueryDutiesDto {
  @IsOptional()
  @IsDateString()
  weekStart?: string;

  @IsOptional()
  @IsDateString()
  weekEnd?: string;

  @IsOptional()
  @IsIn(['midweek', 'weekend'])
  eventType?: EventType;
}
