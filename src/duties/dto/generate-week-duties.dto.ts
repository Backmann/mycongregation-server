import { IsDateString, IsIn } from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';

export class GenerateWeekDutiesDto {
  @IsDateString()
  weekStartDate!: string;

  @IsIn(['midweek', 'weekend'])
  eventType!: EventType;
}
