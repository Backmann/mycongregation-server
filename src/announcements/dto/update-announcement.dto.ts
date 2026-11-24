import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ANNOUNCEMENT_MAX } from './create-announcement.dto';

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ANNOUNCEMENT_MAX)
  text?: string;

  @IsOptional()
  @IsBoolean()
  isLetter?: boolean;
}
