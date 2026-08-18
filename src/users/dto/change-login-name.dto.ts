import { IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { LOGIN_NAME_MAX } from '../login-name';

/**
 * Correcting what somebody types to sign in.
 *
 * Separate from changing an address on purpose: one is identity, the other is
 * delivery, and putting them behind one call is how they came to be confused
 * in the first place.
 */
export class ChangeLoginNameDto {
  @IsString()
  @MaxLength(LOGIN_NAME_MAX)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  loginName!: string;
}
