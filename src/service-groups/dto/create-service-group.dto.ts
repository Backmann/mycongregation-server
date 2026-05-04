import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateServiceGroupDto {
  @IsString()
  @Length(1, 255)
  name!: string;

  @IsOptional()
  @IsUUID()
  overseerPublisherId?: string;

  @IsOptional()
  @IsUUID()
  assistantPublisherId?: string;

  @IsOptional()
  @IsString()
  meetingLocation?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
