import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Request,
  Res,
} from '@nestjs/common';
import { resolve, sep } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { canUser } from '../config/permission-matrix';
import { DocumentUpload } from './document-upload';

const MAGIC_SIGNATURES: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
  { mime: 'image/bmp', bytes: [0x42, 0x4d] },
  { mime: 'image/tiff', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { mime: 'image/tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
];

function checkMagicBytes(buffer: Buffer): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) return sig.mime;
  }
  return null;
}

function extensionForMime(mime: string): string {
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/bmp') return '.bmp';
  if (mime === 'image/tiff') return '.tif';
  return '.bin';
}

@Controller('uploads')
export class UploadController {
  constructor(private readonly prisma: PrismaService) {}

  private async assertDocumentAccess(documentId: string, user: any) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document introuvable');

    const isAdmin = user?.role === 'admin';
    const isOwner = doc.ownerId === user?.id;
    if (isAdmin || isOwner) return doc;

    const userPerm = await this.prisma.documentPermission.findUnique({
      where: { documentId_userId: { documentId, userId: user?.id } },
    });
    if (userPerm) return doc;

    const memberships = await this.prisma.groupMember.findMany({
      where: { userId: user?.id },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m: any) => m.groupId);
    if (groupIds.length > 0) {
      const groupPerm = await this.prisma.documentPermission.findFirst({
        where: { documentId, groupId: { in: groupIds } },
      });
      if (groupPerm) return doc;
    }

    throw new ForbiddenException('Accès refusé');
  }

  @Post('document')
  async uploadDocument(@Request() req: any, @Res({ passthrough: true }) res: any) {
    // Authentication/enrollment guards have already run. Check the configurable
    // upload permission before Multer can parse or write any multipart content.
    if (!(await canUser(req.user?.role, 'uploadDocument'))) {
      throw new ForbiddenException('Droits insuffisants pour importer un document');
    }
    const upload = new DocumentUpload(req, res);
    try {
      const file = await upload.receive();
      if (!file) throw new BadRequestException('Fichier manquant');
      // A permission may have been revoked while an authorized body was streaming.
      if (!(await canUser(req.user?.role, 'uploadDocument'))) {
        throw new ForbiddenException('Droits insuffisants pour importer un document');
      }
      upload.assertConnected();
      const detectedMime = checkMagicBytes(await upload.header());
      if (!detectedMime || file.mimetype.includes('svg')) {
        throw new BadRequestException('Format non supporté (PDF/Image uniquement)');
      }
      const finalName = await upload.promote(extensionForMime(detectedMime));
      upload.assertConnected();
      const created = await this.prisma.document.create({
        data: {
          originalName: file.originalname, mimeType: detectedMime,
          size: file.size, path: finalName, ownerId: req.user?.id,
        },
      });
      // Do not delete a committed document if the client disconnects during the
      // insert or the delivery of the response. Wait for the database outcome.
      upload.markCommitted();
      return {
        id: created.id, originalName: created.originalName,
        mimeType: created.mimeType, size: created.size,
        url: `/api/uploads/file/${created.id}`,
      };
    } finally { await upload.dispose(); }
  }

  @Get('file/:id')
  async streamDocument(@Param('id') id: string, @Request() req: any, @Res() res: any) {
    const doc = await this.assertDocumentAccess(id, req.user);
    const uploadsRoot = resolve(process.cwd(), 'uploads');
    const absPath = resolve(uploadsRoot, doc.path);

    // Defense-in-depth: prevent path traversal even if doc.path is compromised
    if (!absPath.startsWith(uploadsRoot + sep)) {
      throw new ForbiddenException('Chemin de fichier invalide');
    }

    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(absPath);
  }

  @Get(':id')
  async getDocument(@Param('id') id: string, @Request() req: any) {
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
}
