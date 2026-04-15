import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { UsersModule } from './users/users.module';
import { GroupsModule } from './groups/groups.module';
import { PermissionsModule } from './permissions/permissions.module';
import { DetectController } from './detect/detect.controller';
import { HealthController } from './health.controller';
import { FoldersController } from './folders.controller';
import { PrismaModule } from './prisma/prisma.module';
import { TemplatesController } from './templates/templates.controller';
import { TemplatesService } from './templates/templates.service';
import { UploadController } from './upload/upload.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { DraftsController } from './drafts/drafts.controller';
import { DraftsService } from './drafts/drafts.service';
import { ExportController, ExportAdminController, ExportLogsController } from './export/export.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    PermissionsModule,
    ThrottlerModule.forRoot([{
      name: 'default',
      ttl: 60_000,
      limit: 30,
    }]),
  ],
  controllers: [HealthController, TemplatesController, UploadController, DetectController, FoldersController, AdminSettingsController, DraftsController, ExportAdminController, ExportLogsController, ExportController],
  providers: [
    TemplatesService,
    DraftsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
