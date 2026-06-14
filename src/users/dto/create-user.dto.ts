import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '../../common/enums/user-role.enum';
import { SUPPORTED_LANGUAGES } from '../../common/i18n/supported-languages';

export class CreateUserDto {
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email!: string;

  /**
   * Initial password set by the admin. Must be communicated to the user
   * out-of-band; the user can change it via the (future) self-service
   * password change endpoint. Min length matches the bootstrap convention.
   */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_LANGUAGES], {
    message: `uiLanguage must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`,
  })
  uiLanguage?: string;
}
