import {
  IsDateString,
  IsInt,
  Max,
  Min,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateLocalNeedsTopicDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsUUID()
  speakerPublisherId?: string;

  /** Monday (YYYY-MM-DD) of the week used; omit to keep the topic planned. */
  @IsOptional()
  @IsDateString()
  usedWeek?: string;

  /** The week chosen for it, before that week's programme exists. */
  @IsOptional()
  @IsDateString()
  plannedWeek?: string;

  /** Minutes the topic is meant for. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  durationMin?: number;
}
