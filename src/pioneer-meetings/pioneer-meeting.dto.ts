import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

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

  @IsUUID()
  conductorPublisherId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}
