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
exports.UploadController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const prisma_service_1 = require("../prisma/prisma.service");
const permission_matrix_1 = require("../config/permission-matrix");
const MAGIC_SIGNATURES = [
    { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
    { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
    { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
    { mime: 'image/gif', bytes: [0x47, 0x49, 0x46] },
    { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
    { mime: 'image/bmp', bytes: [0x42, 0x4d] },
    { mime: 'image/tiff', bytes: [0x49, 0x49, 0x2a, 0x00] },
    { mime: 'image/tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
];
function checkMagicBytes(buffer) {
    for (const sig of MAGIC_SIGNATURES) {
        if (sig.bytes.every((b, i) => buffer[i] === b))
            return sig.mime;
    }
    return null;
}
function extensionForMime(mime) {
    if (mime === 'application/pdf')
        return '.pdf';
    if (mime === 'image/png')
        return '.png';
    if (mime === 'image/jpeg')
        return '.jpg';
    if (mime === 'image/gif')
        return '.gif';
    if (mime === 'image/webp')
        return '.webp';
    if (mime === 'image/bmp')
        return '.bmp';
    if (mime === 'image/tiff')
        return '.tif';
    return '.bin';
}
let UploadController = class UploadController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async assertDocumentAccess(documentId, user) {
        const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
        if (!doc)
            throw new common_1.NotFoundException('Document introuvable');
        const isAdmin = user?.role === 'admin';
        const isOwner = doc.ownerId === user?.id;
        if (isAdmin || isOwner)
            return doc;
        const userPerm = await this.prisma.documentPermission.findUnique({
            where: { documentId_userId: { documentId, userId: user?.id } },
        });
        if (userPerm)
            return doc;
        const memberships = await this.prisma.groupMember.findMany({
            where: { userId: user?.id },
            select: { groupId: true },
        });
        const groupIds = memberships.map((m) => m.groupId);
        if (groupIds.length > 0) {
            const groupPerm = await this.prisma.documentPermission.findFirst({
                where: { documentId, groupId: { in: groupIds } },
            });
            if (groupPerm)
                return doc;
        }
        throw new common_1.ForbiddenException('Accès refusé');
    }
    async uploadDocument(file, req) {
        if (!(await (0, permission_matrix_1.canUser)(req.user?.role, 'uploadDocument'))) {
            throw new common_1.ForbiddenException('Droits insuffisants pour importer un document');
        }
        if (!file)
            throw new common_1.BadRequestException('Fichier manquant');
        const buffer = await (0, promises_1.readFile)(file.path);
        const detectedMime = checkMagicBytes(buffer);
        if (!detectedMime || file.mimetype.includes('svg')) {
            const { unlink } = await Promise.resolve().then(() => require('fs/promises'));
            await unlink(file.path).catch(() => { });
            throw new common_1.BadRequestException('Format non supporté (PDF/Image uniquement)');
        }
        const ext = extensionForMime(detectedMime);
        const safeBase = file.filename.replace(/\.bin$/i, '');
        const finalName = `${safeBase}${ext}`;
        if (finalName !== file.filename)
            await (0, promises_1.rename)(file.path, `uploads/${finalName}`);
        const created = await this.prisma.document.create({
            data: {
                originalName: file.originalname,
                mimeType: detectedMime,
                size: file.size,
                path: finalName,
                ownerId: req.user?.id,
            },
        });
        return {
            id: created.id,
            originalName: created.originalName,
            mimeType: created.mimeType,
            size: created.size,
            url: `/api/uploads/file/${created.id}`,
        };
    }
    async streamDocument(id, req, res) {
        const doc = await this.assertDocumentAccess(id, req.user);
        const absPath = (0, path_1.join)(process.cwd(), 'uploads', doc.path);
        res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        return res.sendFile(absPath);
    }
    async getDocument(id, req) {
        const doc = await this.assertDocumentAccess(id, req.user);
        return {
            id: doc.id,
            originalName: doc.originalName,
            mimeType: doc.mimeType,
            size: doc.size,
            path: doc.path,
            url: `/api/uploads/file/${doc.id}`,
        };
    }
};
exports.UploadController = UploadController;
__decorate([
    (0, common_1.Post)('document'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.diskStorage)({
            destination: 'uploads',
            filename: (_, _file, cb) => cb(null, `${(0, crypto_1.randomUUID)()}.bin`),
        }),
        limits: { fileSize: 25 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "uploadDocument", null);
__decorate([
    (0, common_1.Get)('file/:id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "streamDocument", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "getDocument", null);
exports.UploadController = UploadController = __decorate([
    (0, common_1.Controller)('uploads'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UploadController);
//# sourceMappingURL=upload.controller.js.map