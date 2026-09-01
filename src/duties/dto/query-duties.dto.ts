import { IsIn, IsOptional, IsDateString } from 'class-validator';
import { DUTY_MEETINGS, EventType } from '../../common/enums/event-type.enum';

export class QueryDutiesDto {
  @IsOptional()
  @IsDateString()
  weekStart?: string;

  @IsOptional()
  @IsDateString()
  weekEnd?: string;

  @IsOptional()
  @IsIn(DUTY_MEETINGS)
  eventType?: EventType;
}
