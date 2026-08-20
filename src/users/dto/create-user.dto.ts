import {
  IsUUID,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '../../common/enums/user-role.enum';
import { SUPPORTED_LANGUAGES } from '../../common/i18n/supported-languages';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';

export class CreateUserDto {
  /**
   * Where this account's letters go. Optional, and often absent: most of this
   * congregation has no address written down anywhere, and an account without
   * one is invited by a code handed over in person.
   */
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email?: string;

  /**
   * What this person will type to sign in. Generated from the publisher's card
   * when omitted — which is the ordinary case; this is for the correction an
   * elder makes before the name has been told to anybody.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  loginName?: string;

  /**
   * Initial password set by the admin. Must be communicated to the user
   * out-of-band; the user can change it via the (future) self-service
   * password change endpoint. Min length matches the bootstrap convention.
   */
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
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
