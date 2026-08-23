import { ArrayMaxSize, IsArray, IsInt, Max, Min } from 'class-validator';

/**
 * The talks to strike out of the catalogue — by number, exactly as the import
 * reported them.
 *
 * Numbers rather than ids because that is what the screen has in hand and what
 * a brother would read out; the bound is there so a stray request cannot ask
 * the server to walk a list of any length.
 */
export class RetireMissingDto {
  @IsArray()
  @ArrayMaxSize(999)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(999, { each: true })
  numbers!: number[];
}
