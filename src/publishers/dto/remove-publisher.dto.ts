import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { RemovalReason } from '../../common/enums/removal-reason.enum';

export class RemovePublisherDto {
  @IsEnum(RemovalReason)
  reason!: RemovalReason;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === null ? undefined : value,
  )
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
