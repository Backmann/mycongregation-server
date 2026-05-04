import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateFamilyDto {
  @IsString()
  @Length(1, 255)
  name!: string;

  @IsOptional()
  @IsUUID()
  headPublisherId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
