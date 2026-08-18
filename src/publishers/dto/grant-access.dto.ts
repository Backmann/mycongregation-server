import {
  IsBoolean,
  IsEmail,
  IsOptional,
  MaxLength,
  MinLength,
} from 'class-validator';
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
