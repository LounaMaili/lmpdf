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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
let UsersController = class UsersController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async search(q) {
        if (!q || q.length < 2)
            return [];
        return this.prisma.user.findMany({
            where: {
                isActive: true,
                OR: [
                    { email: { contains: q, mode: 'insensitive' } },
                    { displayName: { contains: q, mode: 'insensitive' } },
                ],
            },
            select: { id: true, email: true, displayName: true },
            take: 10,
        });
    }
    async list() {
        const users = await this.prisma.user.findMany({
            select: {
                id: true, email: true, displayName: true, role: true, authSource: true, externalId: true, isActive: true, createdAt: true,
                mfaEnabled: true,
                _count: {
                    select: {
                        backupCodes: true,
                        webauthnCredentials: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return users.map((u) => ({
            id: u.id,
            email: u.email,
            displayName: u.displayName,
            role: u.role,
            authSource: u.authSource,
            externalId: u.externalId,
            isActive: u.isActive,
            createdAt: u.createdAt,
            mfaEnabled: u.mfaEnabled,
            backupCodesCount: u._count.backupCodes,
            webauthnKeysCount: u._count.webauthnCredentials,
        }));
    }
    async get(id) {
        return this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true, email: true, displayName: true, role: true, authSource: true, externalId: true, externalDn: true, isActive: true, createdAt: true,
                memberships: { include: { group: { select: { id: true, name: true } } } },
            },
        });
    }
    async update(id, body) {
        const data = {};
        if (body.displayName !== undefined)
            data.displayName = body.displayName;
        if (body.role !== undefined)
            data.role = body.role;
        if (body.isActive !== undefined)
            data.isActive = body.isActive;
        return this.prisma.user.update({
            where: { id },
            data,
            select: { id: true, email: true, displayName: true, role: true, authSource: true, externalId: true, isActive: true },
        });
    }
    async delete(id) {
        await this.prisma.user.update({ where: { id }, data: { isActive: false } });
        return { deactivated: true };
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)('search'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "search", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('admin'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('admin'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)('admin'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)('admin'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "delete", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    (0, common_1.UseGuards)(roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersController);
//# sourceMappingURL=users.controller.js.map