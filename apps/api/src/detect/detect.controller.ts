import { BadRequestException, Body, Controller, ForbiddenException, Post, Request } from '@nestjs/common';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { PrismaService } from '../prisma/prisma.service';
import { DetectDto } from './dto/detect.dto';
import { canUser } from '../config/permission-matrix';

function postJsonWithTimeout(urlString: string, payload: unknown, timeoutMs = 180_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const data = JSON.stringify(payload);
    const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;

    const req = requester(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });

    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

@Controller('detect')
export class DetectController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async detect(@Body() body: DetectDto, @Request() req: any) {
    if (!(await canUser(req.user?.role, 'editStructure'))) {
      throw new ForbiddenException('Droits insuffisants pour détecter des champs');
    }

    if (!body.documentId) {
      throw new BadRequestException('documentId est requis pour le moment');
    }

    const doc = await this.prisma.document.findUnique({ where: { id: body.documentId } });
    if (!doc) throw new BadRequestException('Document introuvable');

    const visionUrl = process.env.VISION_URL ?? 'http://vision:8001';

    let response: { status: number; body: string };
    try {
      response = await postJsonWithTimeout(`${visionUrl}/detect`, {
        document: {
          id: doc.id,
          path: doc.path,
          mimeType: doc.mimeType,
        },
        options: body.options ?? {},
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Service de détection indisponible ou trop lent (${msg})`);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new BadRequestException(`Vision service error: ${response.status}`);
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(response.body || '{}') as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Vision service error: réponse invalide');
    }
    return {
      documentId: doc.id,
      ...payload,
    };
  }
}
