import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  MaxLength,
  Min,
  IsString,
} from 'class-validator';

/**
 * The talks to strike out of the catalogue — by number, exactly as the import
 * reported them.
 *
 * Numbers rather than ids because that is what the screen has in hand and what
 * a brother would read out; the bound is there so a stray request cannot ask
 * the server to walk a list of any length.
 */
export class RetireMissingDto {
  /**
   * The date from which they are not to be given — «начиная с 1 сентября
   * 2026 года» in the instruction. Optional so that a talk retired by hand,
   * with no such date, is still possible.
   */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /**
   * The last day of a temporary restriction. Omitted when the talk is set
   * aside for good — the ordinary instruction.
   */
  @IsOptional()
  @IsISO8601()
  until?: string;

  /**
   * Where this came from: «Объявления и напоминания, май 2026». Stored on the
   * talk, so the answer to «на основании чего» is beside the fact itself.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsArray()
  @ArrayMaxSize(999)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(999, { each: true })
  numbers!: number[];
}
