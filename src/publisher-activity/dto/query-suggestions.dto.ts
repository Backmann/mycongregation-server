import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QuerySuggestionsDto {
  /** Monday (YYYY-MM-DD) of the target week; history is strictly before it. */
  @IsDateString()
  weekStart!: string;

  /**
   * Comma-separated equivalent part keys, e.g.
   * "apply_yourself_1,apply_yourself_2". Equivalence (such as the
   * apply-yourself family) is decided by the client.
   */
  @IsString()
  partKeys!: string;

  /** Look-back window in weeks (default 26). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(52)
  weeks?: number;
}
