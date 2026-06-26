import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class BuildCartWeekDto {
  @IsDateString()
  weekStartDate!: string;

  @Matches(HHMM, { message: 'startTime must be "HH:MM"' })
  startTime!: string;

  @Matches(HHMM, { message: 'endTime must be "HH:MM"' })
  endTime!: string;

  @IsIn([60, 90, 120])
  stepMinutes!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek!: number[];

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  locationIds!: string[];
}
