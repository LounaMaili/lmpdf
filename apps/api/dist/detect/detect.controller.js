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
exports.DetectController = void 0;
const common_1 = require("@nestjs/common");
const node_http_1 = require("node:http");
const node_https_1 = require("node:https");
const prisma_service_1 = require("../prisma/prisma.service");
const detect_dto_1 = require("./dto/detect.dto");
const permission_matrix_1 = require("../config/permission-matrix");
function postJsonWithTimeout(urlString, payload, timeoutMs = 180_000) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const data = JSON.stringify(payload);
        const requester = url.protocol === 'https:' ? node_https_1.request : node_http_1.request;
        const req = requester(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on('end', () => {
                resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
            });
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`timeout after ${timeoutMs}ms`));
        });
        req.on('error', (err) => reject(err));
        req.write(data);
        req.end();
    });
}
let DetectController = class DetectController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async detect(body, req) {
        if (!(await (0, permission_matrix_1.canUser)(req.user?.role, 'editStructure'))) {
            throw new common_1.ForbiddenException('Droits insuffisants pour détecter des champs');
        }
        if (!body.documentId) {
            throw new common_1.BadRequestException('documentId est requis pour le moment');
        }
        const doc = await this.prisma.document.findUnique({ where: { id: body.documentId } });
        if (!doc)
            throw new common_1.BadRequestException('Document introuvable');
        const visionUrl = process.env.VISION_URL ?? 'http://vision:8001';
        let response;
        try {
            response = await postJsonWithTimeout(`${visionUrl}/detect`, {
                document: {
                    id: doc.id,
                    path: doc.path,
                    mimeType: doc.mimeType,
                },
                options: body.options ?? {},
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new common_1.BadRequestException(`Service de détection indisponible ou trop lent (${msg})`);
        }
        if (response.status < 200 || response.status >= 300) {
            throw new common_1.BadRequestException(`Vision service error: ${response.status}`);
        }
        let payload;
        try {
            payload = JSON.parse(response.body || '{}');
        }
        catch {
            throw new common_1.BadRequestException('Vision service error: réponse invalide');
        }
        return {
            documentId: doc.id,
            ...payload,
        };
    }
};
exports.DetectController = DetectController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [detect_dto_1.DetectDto, Object]),
    __metadata("design:returntype", Promise)
], DetectController.prototype, "detect", null);
exports.DetectController = DetectController = __decorate([
    (0, common_1.Controller)('detect'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DetectController);
//# sourceMappingURL=detect.controller.js.map