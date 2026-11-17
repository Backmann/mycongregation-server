import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { FolderMarkState } from '../../entities/co-visit-folder-mark.entity';

/** A folder item marked — or the mark taken away (state null). */
export class FolderMarkDto {
  @ValidateIf((_o, v) => v !== null)
  @IsIn(['saved', 'separate', 'paper', 'na'])
  state!: FolderMarkState | null;

  /** The fingerprint the folder gave when the file was made. */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f:]{1,40}$/)
  @MaxLength(40)
  stamp?: string;
}

export class FolderS62Dto {
  @IsIn(['sent', 'checked'])
  what!: 'sent' | 'checked';

  @IsBoolean()
  on!: boolean;
}

export class FolderAnswerDto {
  @ValidateIf((_o, v) => v !== null)
  @IsIn(['yes', 'no', 'na'])
  answer!: 'yes' | 'no' | 'na' | null;
}

export class FolderOnDto {
  @IsBoolean()
  on!: boolean;
}
