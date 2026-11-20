import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MAX_FILE_WEEKS } from '../programme-files.service';

/** «Файлы программы»: the window of weeks to show. */
export class ProgrammeWeeksQueryDto {
  /** Any day of the first week (YYYY-MM-DD); two weeks back by default. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  // A real day: 2026-13-45 and 2026-02-31 are refused, not rolled over.
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FILE_WEEKS)
  count?: number;
}
