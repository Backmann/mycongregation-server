import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  TalkExchangeDirection,
  TalkExchangeStatus,
} from '../../common/enums/talk-exchange.enum';

export class CreateTalkExchangeDto {
  @IsEnum(TalkExchangeDirection)
  direction!: TalkExchangeDirection;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsEnum(TalkExchangeStatus)
  status?: TalkExchangeStatus;

  @IsOptional()
  @IsUUID()
  publicTalkId?: string | null;

  // ---- Incoming ----
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

  // ---- Outgoing ----
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

  /**
   * Incoming only: when the weekend public-talk slot is already filled, set
   * true to overwrite it. Not stored — a control flag for the auto-fill.
   */
  @IsOptional()
  @IsBoolean()
  overwriteProgram?: boolean;
}
