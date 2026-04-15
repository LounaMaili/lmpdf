import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GroupsController } from './groups.controller';

@Module({
  imports: [PrismaModule],
  controllers: [GroupsController],
})
export class GroupsModule {}
