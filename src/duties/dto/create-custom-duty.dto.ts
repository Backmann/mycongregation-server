import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EventType } from '../../common/enums/event-type.enum';

export class CreateCustomDutyDto {
  @IsDateString()
  weekStartDate!: string;

  @IsIn(['midweek', 'weekend'])
  eventType!: EventType;

  @IsString()
  @MaxLength(255)
  customLabel!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  publisherId?: string | null;
}
