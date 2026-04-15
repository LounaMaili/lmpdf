"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const throttler_1 = require("@nestjs/throttler");
const auth_module_1 = require("./auth/auth.module");
const auth_guard_1 = require("./auth/auth.guard");
const roles_guard_1 = require("./auth/roles.guard");
const users_module_1 = require("./users/users.module");
const groups_module_1 = require("./groups/groups.module");
const permissions_module_1 = require("./permissions/permissions.module");
const detect_controller_1 = require("./detect/detect.controller");
const health_controller_1 = require("./health.controller");
const folders_controller_1 = require("./folders.controller");
const prisma_module_1 = require("./prisma/prisma.module");
const templates_controller_1 = require("./templates/templates.controller");
const templates_service_1 = require("./templates/templates.service");
const upload_controller_1 = require("./upload/upload.controller");
const admin_settings_controller_1 = require("./admin-settings.controller");
const drafts_controller_1 = require("./drafts/drafts.controller");
const drafts_service_1 = require("./drafts/drafts.service");
const export_controller_1 = require("./export/export.controller");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            groups_module_1.GroupsModule,
            permissions_module_1.PermissionsModule,
            throttler_1.ThrottlerModule.forRoot([{
                    name: 'default',
                    ttl: 60_000,
                    limit: 30,
                }]),
        ],
        controllers: [health_controller_1.HealthController, templates_controller_1.TemplatesController, upload_controller_1.UploadController, detect_controller_1.DetectController, folders_controller_1.FoldersController, admin_settings_controller_1.AdminSettingsController, drafts_controller_1.DraftsController, export_controller_1.ExportAdminController, export_controller_1.ExportLogsController, export_controller_1.ExportController],
        providers: [
            templates_service_1.TemplatesService,
            drafts_service_1.DraftsService,
            { provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard },
            { provide: core_1.APP_GUARD, useClass: auth_guard_1.JwtAuthGuard },
            { provide: core_1.APP_GUARD, useClass: roles_guard_1.RolesGuard },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map