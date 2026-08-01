import { IsOptional, IsUUID } from 'class-validator';

/**
 * Which publisher card an account speaks for.
 *
 * Null is allowed and meaningful: an administrator who is not a publisher of
 * this congregation has no card to point at, and refusing that would lock the
 * one person who could fix everything else out of their own account.
 */
export class LinkPublisherDto {
  @IsOptional()
  @IsUUID()
  publisherId?: string | null;
}
