import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { DUTY_MEETINGS, EventType } from '../../common/enums/event-type.enum';

export class CreateCustomDutyDto {
  @IsDateString()
  weekStartDate!: string;

  @IsIn(DUTY_MEETINGS)
  eventType!: EventType;

  @IsString()
  @MaxLength(255)
  customLabel!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  publisherId?: string | null;
}
