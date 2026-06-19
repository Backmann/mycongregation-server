import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
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

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
