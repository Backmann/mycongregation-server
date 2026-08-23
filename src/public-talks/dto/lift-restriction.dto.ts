import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Talks whose restriction a letter has lifted.
 *
 * The reason is asked for here too, and for the same purpose as when they were
 * set aside: a year later somebody asks why a talk came back, and «письмо от
 * такого-то» is the whole answer.
 */
export class LiftRestrictionDto {
  @IsArray()
  @ArrayMaxSize(999)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(999, { each: true })
  numbers!: number[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
