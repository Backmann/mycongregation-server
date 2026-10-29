import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ServiceLogEntryDto {
  /** The day served, «YYYY-MM-DD». */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  day!: string;

  @IsInt()
  @Min(1)
  @Max(720)
  minutes!: number;

  @IsIn(['field', 'credit'])
  kind!: 'field' | 'credit';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;
}
