import {
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A «не посещать» address added by hand (12 November 2026). */
export class CreateNoCallDto {
  @IsString()
  @Length(1, 300)
  @Matches(/\S/)
  address!: string;

  /** Only where the flat cannot be found without it. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  surname?: string;

  /** When it was noted; today when left out. */
  @IsOptional()
  @Matches(DAY)
  notedOn?: string;
}

/** A correction: only the fields sent change; an empty surname clears it. */
export class UpdateNoCallDto {
  @IsOptional()
  @IsString()
  @Length(1, 300)
  @Matches(/\S/)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  surname?: string;

  @IsOptional()
  @Matches(DAY)
  notedOn?: string;
}
