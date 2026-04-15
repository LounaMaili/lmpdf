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
exports.GroupsController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let GroupsController = class GroupsController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(req) {
        if (req.user.role === 'admin') {
            return this.prisma.group.findMany({
                include: { _count: { select: { members: true } } },
                orderBy: { name: 'asc' },
            });
        }
        return this.prisma.group.findMany({
            where: {
                OR: [
                    { members: { some: { userId: req.user.id } } },
                    { createdById: req.user.id },
                ],
            },
            include: { _count: { select: { members: true } } },
            orderBy: { name: 'asc' },
        });
    }
    async create(body, req) {
        const isAdmin = req.user.role === 'admin';
        const createdById = (isAdmin && !body.personal) ? null : req.user.id;
        return this.prisma.group.create({
            data: {
                name: body.name,
                description: body.description,
                createdById,
            },
        });
    }
    async get(id, req) {
        const group = await this.prisma.group.findUnique({
            where: { id },
            include: {
                members: {
                    include: { user: { select: { id: true, email: true, displayName: true } } },
                },
            },
        });
        if (!group)
            throw new common_1.NotFoundException('Groupe introuvable');
        const isAdmin = req.user.role === 'admin';
        const isCreator = group.createdById === req.user.id;
        const isMember = group.members.some((m) => m.userId === req.user.id);
        if (!isAdmin && !isCreator && !isMember)
            throw new common_1.ForbiddenException('Accès refusé');
        return group;
    }
    async update(id, body, req) {
        const group = await this.prisma.group.findUnique({ where: { id } });
        if (!group)
            throw new common_1.NotFoundException('Groupe introuvable');
        const isAdmin = req.user.role === 'admin';
        const isCreator = group.createdById === req.user.id;
        if (!isAdmin && !isCreator)
            throw new common_1.ForbiddenException('Seul le créateur ou un admin peut modifier ce groupe');
        return this.prisma.group.update({
            where: { id },
            data: {
                ...(body.name && { name: body.name }),
                ...(body.description !== undefined && { description: body.description }),
            },
        });
    }
    async delete(id, req) {
        const group = await this.prisma.group.findUnique({ where: { id } });
        if (!group)
            throw new common_1.NotFoundException('Groupe introuvable');
        const isAdmin = req.user.role === 'admin';
        const isCreator = group.createdById === req.user.id;
        if (!isAdmin && !isCreator)
            throw new common_1.ForbiddenException('Seul le créateur ou un admin peut supprimer ce groupe');
        await this.prisma.group.delete({ where: { id } });
        return { deleted: true };
    }
    async addMember(groupId, body, req) {
        const group = await this.prisma.group.findUnique({ where: { id: groupId } });
        if (!group)
            throw new common_1.NotFoundException('Groupe introuvable');
        const isAdmin = req.user.role === 'admin';
        const isCreator = group.createdById === req.user.id;
        if (!isAdmin && !isCreator)
            throw new common_1.ForbiddenException('Seul le créateur ou un admin peut ajouter des membres');
        return this.prisma.groupMember.create({
            data: {
                groupId,
                userId: body.userId,
                role: body.role || 'editor',
            },
        });
    }
    async removeMember(groupId, userId, req) {
        const group = await this.prisma.group.findUnique({ where: { id: groupId } });
        if (!group)
            throw new common_1.NotFoundException('Groupe introuvable');
        const isAdmin = req.user.role === 'admin';
        const isCreator = group.createdById === req.user.id;
        if (!isAdmin && !isCreator)
            throw new common_1.ForbiddenException('Seul le créateur ou un admin peut retirer des membres');
        await this.prisma.groupMember.deleteMany({ where: { groupId, userId } });
        return { removed: true };
    }
};
exports.GroupsController = GroupsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "delete", null);
__decorate([
    (0, common_1.Post)(':id/members'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "addMember", null);
__decorate([
    (0, common_1.Delete)(':id/members/:userId'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('userId')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], GroupsController.prototype, "removeMember", null);
exports.GroupsController = GroupsController = __decorate([
    (0, common_1.Controller)('groups'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GroupsController);
//# sourceMappingURL=groups.controller.js.map