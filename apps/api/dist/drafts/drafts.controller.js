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
exports.DraftsController = void 0;
const common_1 = require("@nestjs/common");
const drafts_service_1 = require("./drafts.service");
let DraftsController = class DraftsController {
    constructor(draftsService) {
        this.draftsService = draftsService;
    }
    async upsert(body, req) {
        const userId = req.user.id;
        const key = { templateId: body.templateId, sourceFileId: body.sourceFileId };
        return this.draftsService.upsert(userId, key, body.payload);
    }
    async get(templateId, sourceFileId, req) {
        const userId = req.user.id;
        const draft = await this.draftsService.get(userId, { templateId, sourceFileId });
        if (!draft)
            return { draft: null };
        return { draft };
    }
    async clear(templateId, sourceFileId, req) {
        const userId = req.user.id;
        return this.draftsService.clear(userId, { templateId, sourceFileId });
    }
};
exports.DraftsController = DraftsController;
__decorate([
    (0, common_1.Put)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DraftsController.prototype, "upsert", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('templateId')),
    __param(1, (0, common_1.Query)('sourceFileId')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], DraftsController.prototype, "get", null);
__decorate([
    (0, common_1.Delete)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Query)('templateId')),
    __param(1, (0, common_1.Query)('sourceFileId')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], DraftsController.prototype, "clear", null);
exports.DraftsController = DraftsController = __decorate([
    (0, common_1.Controller)('drafts'),
    __metadata("design:paramtypes", [drafts_service_1.DraftsService])
], DraftsController);
//# sourceMappingURL=drafts.controller.js.map