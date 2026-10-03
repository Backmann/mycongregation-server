import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WEB_DEVICE_KINDS } from '../device-kind';

class WebPushSubscriptionKeysDto {
  @IsString()
  @MaxLength(255)
  p256dh!: string;

  @IsString()
  @MaxLength(255)
  auth!: string;
}

export class RegisterWebPushSubscriptionDto {
  @IsString()
  @MaxLength(2048)
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => WebPushSubscriptionKeysDto)
  keys!: WebPushSubscriptionKeysDto;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;

  /** What the device is, said by the device: a user agent cannot tell an iPad from a Mac. */
  @IsOptional()
  @IsIn(WEB_DEVICE_KINDS)
  deviceKind?: (typeof WEB_DEVICE_KINDS)[number];
}

export class UnregisterWebPushSubscriptionDto {
  @IsString()
  @MaxLength(2048)
  endpoint!: string;
}
