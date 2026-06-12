import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Payload of POST /…/apply — a Meeting Workbook parsed on the CLIENT.
 * Contains only derived schedule metadata (part keys, titles, durations);
 * no publication file ever reaches the server.
 */
export class ApplyParsedPartDto {
  @IsString()
  @Length(1, 64)
  partKey!: string;

  @IsInt()
  @Min(0)
  partOrder!: number;

  /** Final display title; null for synthetic parts (chairman, CBS reader). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  partTitle?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  partDurationMin?: number | null;
}

export class ApplyParsedWeekDto {
  @IsDateString()
  weekStartDate!: string;

  @IsDateString()
  weekEndDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  biblePassage?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ApplyParsedPartDto)
  parts!: ApplyParsedPartDto[];
}

export class ApplyParsedDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  epubFile?: string;

  @IsOptional()
  @IsInt()
  year?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ApplyParsedWeekDto)
  weeks!: ApplyParsedWeekDto[];
}
