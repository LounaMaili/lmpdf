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
exports.FoldersController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("./prisma/prisma.service");
let FoldersController = class FoldersController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(req) {
        if (req.user?.role === 'admin') {
            return this.prisma.folder.findMany({ orderBy: [{ parentId: 'asc' }, { name: 'asc' }] });
        }
        return this.prisma.folder.findMany({
            where: {
                OR: [
                    { ownerId: req.user?.id },
                    { group: { members: { some: { userId: req.user?.id } } } },
                ],
            },
            orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
        });
    }
    async create(body, req) {
        const data = {
            name: body.name,
            parentId: body.parentId,
        };
        if (body.ownerScope === 'group' && body.groupId) {
            data.groupId = body.groupId;
            data.ownerId = null;
        }
        else {
            data.ownerId = req.user?.id;
            data.groupId = null;
        }
        return this.prisma.folder.create({ data });
    }
    async rename(id, body, req) {
        const folder = await this.prisma.folder.findUnique({ where: { id } });
        if (!folder)
            throw new common_1.ForbiddenException('Dossier introuvable');
        const isAdmin = req.user?.role === 'admin';
        const canEdit = isAdmin || folder.ownerId === req.user?.id;
        if (!canEdit)
            throw new common_1.ForbiddenException('Accès refusé');
        return this.prisma.folder.update({ where: { id }, data: { name: body.name } });
    }
    async delete(id, req) {
        const folder = await this.prisma.folder.findUnique({ where: { id } });
        if (!folder)
            throw new common_1.NotFoundException('Dossier introuvable');
        const isAdmin = req.user?.role === 'admin';
        const canEdit = isAdmin || folder.ownerId === req.user?.id;
        if (!canEdit)
            throw new common_1.ForbiddenException('Accès refusé');
        await this.prisma.document.updateMany({ where: { folderId: id }, data: { folderId: null } });
        await this.prisma.template.updateMany({ where: { folderId: id }, data: { folderId: null } });
        await this.prisma.folder.delete({ where: { id } });
        return { deleted: true };
    }
    async moveDocument(folderId, body, req) {
        const doc = await this.prisma.document.findUnique({ where: { id: body.documentId } });
        if (!doc)
            throw new common_1.ForbiddenException('Document introuvable');
        const isAdmin = req.user?.role === 'admin';
        const canEdit = isAdmin || doc.ownerId === req.user?.id;
        if (!canEdit)
            throw new common_1.ForbiddenException('Accès refusé');
        return this.prisma.document.update({ where: { id: body.documentId }, data: { folderId } });
    }
    async moveTemplate(folderId, body, req) {
        const tpl = await this.prisma.template.findUnique({ where: { id: body.templateId } });
        if (!tpl)
            throw new common_1.ForbiddenException('Template introuvable');
        const isAdmin = req.user?.role === 'admin';
        const canEdit = isAdmin || tpl.ownerId === req.user?.id;
        if (!canEdit)
            throw new common_1.ForbiddenException('Accès refusé');
        return this.prisma.template.update({ where: { id: body.templateId }, data: { folderId } });
    }
};
exports.FoldersController = FoldersController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "rename", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "delete", null);
__decorate([
    (0, common_1.Patch)(':id/move-document'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "moveDocument", null);
__decorate([
    (0, common_1.Patch)(':id/move-template'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], FoldersController.prototype, "moveTemplate", null);
exports.FoldersController = FoldersController = __decorate([
    (0, common_1.Controller)('folders'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], FoldersController);
//# sourceMappingURL=folders.controller.js.map