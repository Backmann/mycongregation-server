import { IsNotEmpty, IsString } from 'class-validator';

export class EraseAccountDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}
