import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { LOGIN_NAME_MAX } from '../../users/login-name';
import { PASSWORD_MIN_LENGTH } from '../../auth/password-policy';

/**
 * Grant a login to an existing publisher. The email defaults to the
 * publisher's own email when omitted; the role is derived from the
 * publisher's appointment unless `isAdmin` is set.
 */
export class GrantAccessDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  /**
   * The name this publisher will sign in with — corrected by the elder before
   * anybody is told what it is.
   *
   * It was missing here entirely: the form has offered the field since the
   * screen was rebuilt, and the request was refused outright by validation
   * («property loginName should not exist»). Omitted, the name is generated
   * from the publisher's card as before.
   */
  @IsOptional()
  @IsString()
  @MaxLength(LOGIN_NAME_MAX)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  loginName?: string;

  @IsOptional()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  /** When true, create the account without a password and email an
   * invitation link to set one (instead of an admin-set password). */
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;

  /**
   * Also write this address onto the publisher's card.
   *
   * Asked for rather than assumed, because the card's address is a PRIVATE
   * field the elders read as «how to reach this person». An address borrowed
   * for one delivery — a wife's letter sent to her husband's mailbox — is not
   * that, and writing it there would have the secretary confirming it as hers
   * at the yearly contacts check.
   */
  @IsOptional()
  @IsBoolean()
  saveEmailToCard?: boolean;
}
