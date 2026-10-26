import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../../common/enums/talk-exchange.enum';

export class UpdateTalkExchangeDto {
  @IsOptional()
  @IsEnum(TalkExchangeDirection)
  direction?: TalkExchangeDirection;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsEnum(TalkExchangeStatus)
  status?: TalkExchangeStatus;

  @IsOptional()
  @IsUUID()
  publicTalkId?: string | null;

  /** Тема специальной речи; вместе с ней номер речи не хранится. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  specialTheme?: string | null;

  @IsOptional()
  @IsUUID()
  visitingSpeakerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  speakerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  speakerCongregation?: string;

  @IsOptional()
  @IsUUID()
  hospitalityPublisherId?: string | null;

  /** The guest's opening song; null clears it. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  openingSong?: number | null;

  @IsOptional()
  @IsUUID()
  publisherId?: string | null;

  @IsOptional()
  @IsUUID()
  hostCongregationId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsBoolean()
  overwriteProgram?: boolean;
}
