import { IsDateString, IsIn } from 'class-validator';
import { DUTY_MEETINGS, EventType } from '../../common/enums/event-type.enum';

export class GenerateWeekDutiesDto {
  @IsDateString()
  weekStartDate!: string;

  @IsIn(DUTY_MEETINGS)
  eventType!: EventType;
}
