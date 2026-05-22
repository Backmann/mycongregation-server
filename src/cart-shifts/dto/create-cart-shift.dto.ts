import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsDateString,
  Matches,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateCartShiftDto {
  @IsDateString()
  date!: string;

  @Matches(HHMM, { message: 'startTime must be "HH:MM"' })
  startTime!: string;

  @Matches(HHMM, { message: 'endTime must be "HH:MM"' })
  endTime!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location!: string;
}
