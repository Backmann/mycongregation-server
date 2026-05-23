import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class AddGroupMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  publisherIds!: string[];
}
