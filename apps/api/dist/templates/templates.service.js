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
exports.TemplatesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
function isAdmin(user) {
    return user.role === 'admin';
}
function toApiFieldType(type) {
    if (type === 'counter_tally')
        return 'counter-tally';
    if (type === 'counter_numeric')
        return 'counter-numeric';
    return type;
}
let TemplatesService = class TemplatesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    normalizeTemplate(tpl) {
        return {
            ...tpl,
            fields: tpl.fields.map((f) => ({
                ...f,
                type: toApiFieldType(f.type),
            })),
        };
    }
    async userGroupIds(userId) {
        const memberships = await this.prisma.groupMember.findMany({
            where: { userId },
            select: { groupId: true },
        });
        return memberships.map((m) => m.groupId);
    }
    async hasDocAccess(documentId, user) {
        if (isAdmin(user))
            return true;
        const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
        if (!doc)
            return false;
        if (doc.ownerId === user.id)
            return true;
        const userPerm = await this.prisma.documentPermission.findUnique({
            where: { documentId_userId: { documentId, userId: user.id } },
        });
        if (userPerm)
            return true;
        const groupIds = await this.userGroupIds(user.id);
        if (groupIds.length > 0) {
            const groupPerm = await this.prisma.documentPermission.findFirst({
                where: { documentId, groupId: { in: groupIds } },
            });
            if (groupPerm)
                return true;
        }
        return false;
    }
    async create(payload, user) {
        if (payload.sourceFileId) {
            const hasAccess = await this.hasDocAccess(payload.sourceFileId, user);
            if (!hasAccess)
                throw new common_1.ForbiddenException('Accès refusé au document source');
        }
        const created = await this.prisma.template.create({
            data: {
                name: payload.name,
                sourceFileId: payload.sourceFileId,
                rotation: payload.rotation ?? 0,
                ownerId: user.id,
                fields: {
                    create: payload.fields.map((f) => {
                        const typeMap = {
                            text: 'text',
                            checkbox: 'checkbox',
                            'counter-tally': 'counter_tally',
                            'counter-numeric': 'counter_numeric',
                            date: 'date',
                        };
                        return {
                            label: f.label,
                            value: f.value ?? '',
                            style: f.style ?? undefined,
                            x: f.x,
                            y: f.y,
                            w: f.w,
                            h: f.h,
                            type: typeMap[f.type] ?? 'text',
                            locked: f.locked ?? false,
                            overlayVisible: f.overlayVisible ?? true,
                            pageNumber: f.pageNumber ?? 1,
                        };
                    }),
                },
            },
            include: { fields: true },
        });
        return this.normalizeTemplate(created);
    }
    async list(user) {
        if (isAdmin(user)) {
            const rows = await this.prisma.template.findMany({
                include: { fields: true },
                orderBy: { createdAt: 'desc' },
            });
            return rows.map((t) => this.normalizeTemplate(t));
        }
        const groupIds = await this.userGroupIds(user.id);
        const docPerms = await this.prisma.documentPermission.findMany({
            where: {
                OR: [
                    { userId: user.id },
                    ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
                ],
            },
            select: { documentId: true },
        });
        const sharedDocIds = [...new Set(docPerms.map((p) => p.documentId))];
        const rows = await this.prisma.template.findMany({
            where: {
                OR: [
                    { ownerId: user.id },
                    ...(sharedDocIds.length > 0 ? [{ sourceFileId: { in: sharedDocIds } }] : []),
                ],
            },
            include: { fields: true },
            orderBy: { createdAt: 'desc' },
        });
        return rows.map((t) => this.normalizeTemplate(t));
    }
    async get(id, user) {
        const found = await this.prisma.template.findUnique({
            where: { id },
            include: { fields: true },
        });
        if (!found)
            throw new common_1.NotFoundException('Template introuvable');
        if (!isAdmin(user) && found.ownerId !== user.id) {
            if (found.sourceFileId) {
                const hasAccess = await this.hasDocAccess(found.sourceFileId, user);
                if (!hasAccess)
                    throw new common_1.ForbiddenException('Accès refusé');
            }
            else {
                throw new common_1.ForbiddenException('Accès refusé');
            }
        }
        return this.normalizeTemplate(found);
    }
    async rename(id, name, user) {
        const found = await this.prisma.template.findUnique({ where: { id } });
        if (!found)
            throw new common_1.NotFoundException('Template introuvable');
        if (!isAdmin(user) && found.ownerId && found.ownerId !== user.id) {
            throw new common_1.ForbiddenException('Accès refusé');
        }
        const updated = await this.prisma.template.update({
            where: { id },
            data: { name },
            include: { fields: true },
        });
        return this.normalizeTemplate(updated);
    }
    async delete(id, user) {
        const found = await this.prisma.template.findUnique({ where: { id } });
        if (!found)
            throw new common_1.NotFoundException('Template introuvable');
        if (!isAdmin(user) && found.ownerId && found.ownerId !== user.id) {
            throw new common_1.ForbiddenException('Accès refusé');
        }
        await this.prisma.template.delete({ where: { id } });
        return { deleted: true };
    }
};
exports.TemplatesService = TemplatesService;
exports.TemplatesService = TemplatesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TemplatesService);
//# sourceMappingURL=templates.service.js.map