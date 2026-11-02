import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/** Sign-up opened, optionally «до четверга». */
export class OpenCartWeekDto {
  @IsOptional()
  @IsDateString()
  signupUntil?: string;
}

/** The stand's memo for everyone who stands; empty clears it. */
export class CartMemoDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  memo?: string | null;
}
