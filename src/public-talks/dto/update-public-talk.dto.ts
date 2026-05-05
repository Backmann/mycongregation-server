import { PartialType } from '@nestjs/mapped-types';
import { CreatePublicTalkDto } from './create-public-talk.dto';

export class UpdatePublicTalkDto extends PartialType(CreatePublicTalkDto) {}
