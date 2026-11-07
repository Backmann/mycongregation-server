import { IsBoolean, IsOptional } from 'class-validator';

export class FeedOptionsDto {
  @IsOptional()
  @IsBoolean()
  mine?: boolean;

  @IsOptional()
  @IsBoolean()
  events?: boolean;

  @IsOptional()
  @IsBoolean()
  names?: boolean;
}
