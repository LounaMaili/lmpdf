"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsController = void 0;
const common_1 = require("@nestjs/common");
const permissions_service_1 = require("./permissions.service");
const share_dto_1 = require("./dto/share.dto");
let PermissionsController = class PermissionsController {
    constructor(permissionsService) {
        this.permissionsService = permissionsService;
    }
    list(docId, req) {
        return this.permissionsService.listPermissions(docId, req.user);
    }
    share(docId, body, req) {
        return this.permissionsService.share(docId, req.user, body.userId, body.groupId, body.docRole);
    }
    revoke(docId, body, req) {
        return this.permissionsService.revoke(docId, req.user, body.userId, body.groupId);
    }
    async myRole(docId, req) {
        const role = await this.permissionsService.resolveDocRole(docId, req.user);
        return { documentId: docId, docRole: role };
    }
};
exports.PermissionsController = PermissionsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Param)('docId')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PermissionsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Param)('docId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, share_dto_1.ShareDocumentDto, Object]),
    __metadata("design:returntype", void 0)
], PermissionsController.prototype, "share", null);
__decorate([
    (0, common_1.Delete)(),
    __param(0, (0, common_1.Param)('docId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, share_dto_1.RevokeShareDto, Object]),
    __metadata("design:returntype", void 0)
], PermissionsController.prototype, "revoke", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Param)('docId')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "myRole", null);
exports.PermissionsController = PermissionsController = __decorate([
    (0, common_1.Controller)('documents/:docId/permissions'),
    __metadata("design:paramtypes", [permissions_service_1.PermissionsService])
], PermissionsController);
//# sourceMappingURL=permissions.controller.js.map