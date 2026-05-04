import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RemovalReason } from '../../common/enums/removal-reason.enum';

export class RemovePublisherDto {
  @IsEnum(RemovalReason)
  reason!: RemovalReason;

  @IsOptional()
  @IsString()
  note?: string;
}
