import { Module } from '@nestjs/common';
import { DevInfoController } from './dev-info.controller';

@Module({ controllers: [DevInfoController] })
export class DevInfoModule {}
