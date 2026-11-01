import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class MergePreviewDto {
  /** The card that stays. */
  @IsUUID()
  keptId!: string;

  /** The card that comes over and is deleted. */
  @IsUUID()
  mergedId!: string;

  /** Both cards have a sign-in: the one that would stay. */
  @IsOptional()
  @IsUUID()
  keepUserId?: string;
}

export class MergeDto extends MergePreviewDto {
  /** The preview's fingerprint: the merge is refused if anything changed. */
  @IsString()
  @Length(32, 32)
  fingerprint!: string;

  /** Conflict key → chosen option id. */
  @IsOptional()
  @IsObject()
  choices?: Record<string, string>;

  /** Field → whose value stays, for fields both cards fill differently. */
  @IsOptional()
  @IsObject()
  fields?: Record<string, 'kept' | 'merged'>;
}

export class DuplicatesQueryDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  /** The card being edited — not a duplicate of itself. */
  @IsOptional()
  @IsUUID()
  exceptId?: string;
}
