import {
  IsDateString,
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
}
