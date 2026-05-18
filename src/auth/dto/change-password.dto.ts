import { IsString, MinLength } from 'class-validator';

/**
 * Self-service password change. Requires verification of the current
 * password — this is the layer that distinguishes "I know my password
 * and want to change it" from "I'm an admin resetting someone else's".
 */
export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
