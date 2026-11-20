import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { MAX_FILE_WEEKS } from '../programme-files.service';

/** «Файлы программы»: the window of weeks to show. */
export class ProgrammeWeeksQueryDto {
  /** Any day of the first week (YYYY-MM-DD); two weeks back by default. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_FILE_WEEKS)
  count?: number;
}
