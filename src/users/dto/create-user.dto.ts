import {
  IsUUID,
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

  /**
   * The publisher card this account will speak for.
   *
   * Optional in the type, deliberate in the interface: granting access FROM a
   * card always linked it, while creating a login here did not, and the two
   * paths quietly produced different results. The person then signed in to
   * find every personal screen shut. Now the choice is made where the account
   * is made.
   */
  @IsOptional()
  @IsUUID()
  publisherId?: string;
}
