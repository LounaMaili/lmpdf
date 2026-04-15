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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let PermissionsService = class PermissionsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async resolveDocRole(documentId, user) {
        if (user.role === 'admin')
            return 'owner';
        const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
        if (!doc)
            return null;
        if (doc.ownerId === user.id)
            return 'owner';
        const userPerm = await this.prisma.documentPermission.findUnique({
            where: { documentId_userId: { documentId, userId: user.id } },
        });
        if (userPerm)
            return userPerm.docRole;
        const memberships = await this.prisma.groupMember.findMany({
            where: { userId: user.id },
            select: { groupId: true },
        });
        if (memberships.length > 0) {
            const groupIds = memberships.map((m) => m.groupId);
            const groupPerms = await this.prisma.documentPermission.findMany({
                where: { documentId, groupId: { in: groupIds } },
            });
            if (groupPerms.length > 0) {
                const priority = { owner: 3, editor: 2, filler: 1 };
                groupPerms.sort((a, b) => priority[b.docRole] - priority[a.docRole]);
                return groupPerms[0].docRole;
            }
        }
        return null;
    }
    async requireDocRole(documentId, user, minRole) {
        const effective = await this.resolveDocRole(documentId, user);
        if (!effective)
            throw new common_1.ForbiddenException('Accès refusé à ce document');
        const priority = { owner: 3, editor: 2, filler: 1 };
        if (priority[effective] < priority[minRole]) {
            throw new common_1.ForbiddenException(`Rôle insuffisant (requis: ${minRole}, actuel: ${effective})`);
        }
        return effective;
    }
    async share(documentId, caller, targetUserId, targetGroupId, docRole = 'filler') {
        if (!targetUserId && !targetGroupId) {
            throw new common_1.BadRequestException('userId ou groupId requis');
        }
        await this.requireDocRole(documentId, caller, 'owner');
        if (targetUserId) {
            const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
            if (!targetUser)
                throw new common_1.NotFoundException('Utilisateur cible introuvable');
            return this.prisma.documentPermission.upsert({
                where: { documentId_userId: { documentId, userId: targetUserId } },
                update: { docRole },
                create: { documentId, userId: targetUserId, docRole },
            });
        }
        if (targetGroupId) {
            const targetGroup = await this.prisma.group.findUnique({ where: { id: targetGroupId } });
            if (!targetGroup)
                throw new common_1.NotFoundException('Groupe cible introuvable');
            return this.prisma.documentPermission.upsert({
                where: { documentId_groupId: { documentId, groupId: targetGroupId } },
                update: { docRole },
                create: { documentId, groupId: targetGroupId, docRole },
            });
        }
    }
    async revoke(documentId, caller, targetUserId, targetGroupId) {
        if (!targetUserId && !targetGroupId) {
            throw new common_1.BadRequestException('userId ou groupId requis');
        }
        await this.requireDocRole(documentId, caller, 'owner');
        if (targetUserId) {
            const existing = await this.prisma.documentPermission.findUnique({
                where: { documentId_userId: { documentId, userId: targetUserId } },
            });
            if (!existing)
                throw new common_1.NotFoundException('Permission introuvable');
            await this.prisma.documentPermission.delete({ where: { id: existing.id } });
        }
        if (targetGroupId) {
            const existing = await this.prisma.documentPermission.findUnique({
                where: { documentId_groupId: { documentId, groupId: targetGroupId } },
            });
            if (!existing)
                throw new common_1.NotFoundException('Permission introuvable');
            await this.prisma.documentPermission.delete({ where: { id: existing.id } });
        }
        return { revoked: true };
    }
    async listPermissions(documentId, caller) {
        await this.requireDocRole(documentId, caller, 'owner');
        return this.prisma.documentPermission.findMany({
            where: { documentId },
            include: {
                user: { select: { id: true, email: true, displayName: true } },
                group: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'asc' },
        });
    }
};
exports.PermissionsService = PermissionsService;
exports.PermissionsService = PermissionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PermissionsService);
//# sourceMappingURL=permissions.service.js.map