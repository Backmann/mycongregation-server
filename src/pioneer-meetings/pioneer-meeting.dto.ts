import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** One who conducts it: a card, or a name written by hand. */
export class PioneerMeetingConductorDto {
  @IsOptional()
  @IsUUID()
  publisherId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string | null;
}

/** The annual meeting with the pioneers, as the form sends it. */
export class PioneerMeetingDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  timeStart?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  timeEnd?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  place?: string | null;

  /** One or two (9 November 2026). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => PioneerMeetingConductorDto)
  conductors?: PioneerMeetingConductorDto[];

  /** The app before 9 November 2026: its one elder. */
  @IsOptional()
  @IsUUID()
  conductorPublisherId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
