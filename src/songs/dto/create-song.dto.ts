import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateSongDto {
  @IsInt()
  @Min(1)
  @Max(999)
  number!: number;

  @IsString()
  @Length(1, 300)
  title!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Its length in seconds (R-77); null clears it. */
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(600)
  durationSec?: number | null;
}
