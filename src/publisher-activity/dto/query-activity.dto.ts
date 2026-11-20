import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryActivityDto {
  /** Monday (YYYY-MM-DD) of the current week; activity covers this week + prior weeks. */
  @IsDateString()
  weekStart!: string;

  /** Number of prior weeks to include (default 4). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(26)
  weeks?: number;

  /** Weeks after the current one to include as well (default 0). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(16)
  ahead?: number;
}
