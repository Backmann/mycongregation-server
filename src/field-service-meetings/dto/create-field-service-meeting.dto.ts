import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFieldServiceMeetingDto {
  @IsDateString()
  weekStartDate!: string;

  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'startTime must be "HH:MM" 24h',
  })
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address!: string;

  @IsOptional()
  @IsUUID()
  conductorPublisherId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  topic?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceUrl?: string | null;
}
