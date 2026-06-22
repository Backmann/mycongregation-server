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

  @IsOptional()
  @IsUUID()
  visitingSpeakerId?: string | null;

  @IsOptional()
  @IsUUID()
  hospitalityPublisherId?: string | null;

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
