import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterPushTokenDto {
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  token!: string;

  @IsOptional()
  @IsObject()
  deviceInfo?: Record<string, any>;
}

export class UnregisterPushTokenDto {
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  token!: string;
}
