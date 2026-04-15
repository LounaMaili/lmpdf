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
exports.DraftsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let DraftsService = class DraftsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async upsert(userId, key, payload) {
        if (key.templateId) {
            return this.prisma.draft.upsert({
                where: {
                    userId_templateId: { userId, templateId: key.templateId },
                },
                create: {
                    userId,
                    templateId: key.templateId,
                    sourceFileId: key.sourceFileId ?? null,
                    payload: payload,
                },
                update: {
                    sourceFileId: key.sourceFileId ?? null,
                    payload: payload,
                },
            });
        }
        if (key.sourceFileId) {
            return this.prisma.draft.upsert({
                where: {
                    userId_sourceFileId: { userId, sourceFileId: key.sourceFileId },
                },
                create: {
                    userId,
                    sourceFileId: key.sourceFileId,
                    payload: payload,
                },
                update: {
                    payload: payload,
                },
            });
        }
        throw new Error('templateId or sourceFileId required');
    }
    async get(userId, key) {
        if (key.templateId) {
            return this.prisma.draft.findUnique({
                where: {
                    userId_templateId: { userId, templateId: key.templateId },
                },
            });
        }
        if (key.sourceFileId) {
            return this.prisma.draft.findUnique({
                where: {
                    userId_sourceFileId: { userId, sourceFileId: key.sourceFileId },
                },
            });
        }
        return null;
    }
    async clear(userId, key) {
        try {
            if (key.templateId) {
                await this.prisma.draft.delete({
                    where: {
                        userId_templateId: { userId, templateId: key.templateId },
                    },
                });
            }
            else if (key.sourceFileId) {
                await this.prisma.draft.delete({
                    where: {
                        userId_sourceFileId: { userId, sourceFileId: key.sourceFileId },
                    },
                });
            }
        }
        catch {
        }
        return { cleared: true };
    }
};
exports.DraftsService = DraftsService;
exports.DraftsService = DraftsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DraftsService);
//# sourceMappingURL=drafts.service.js.map