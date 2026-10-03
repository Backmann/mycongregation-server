import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The device asking for a test: its push token (the phone app) or the address
 * of its browser subscription. Both optional — an older app sends neither and
 * gets the old behaviour.
 */
export class TestNotificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  endpoint?: string;
}
