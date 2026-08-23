import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Ask what retiring would mean — from a pasted instruction, or from numbers
 * already read out of one.
 *
 * `text` is the whole paragraph as it arrives; the server reads the numbers
 * out of it, so the same rule applies whoever asks. `numbers` is for the
 * second press, when the reader has seen the list and is confirming it.
 */
export class RetirementPreviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(999)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(999, { each: true })
  numbers?: number[];

  /** The date from which they are no longer to be given. */
  @IsISO8601()
  from!: string;
}
