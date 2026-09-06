import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Issuing a fresh code — and saying whether a letter should go with it.
 *
 * The choice used to be made for the elder, by the server, before he saw the
 * code: press «выдать код» and the letter was already gone, after which the
 * dialog offered to write one. Now he decides first, and the dialog shows him
 * what actually happened.
 *
 * Optional, defaulting to true on the server: an older app build that sends
 * nothing still gets the behaviour it expects.
 */
export class ResendInviteDto {
  @IsOptional()
  @IsBoolean()
  post?: boolean;
}
