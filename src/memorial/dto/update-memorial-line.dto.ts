import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateMemorialLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;

  /** One of ours. Null clears the line. */
  @IsOptional()
  @IsUUID()
  publisherId?: string | null;

  /** A speaker from another congregation, written by hand. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  personText?: string | null;

  /** The songbook has 151 songs; anything outside that is a typo. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  songNumber?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
