import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Request } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CreateFolderDto, RenameFolderDto, MoveItemDto, MoveTemplateDto } from './folders/dto/folder.dto';

@Controller('folders')
export class FoldersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Request() req: any) {
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

  @Post()
  async create(
    @Body() body: CreateFolderDto,
    @Request() req: any,
  ) {
    const data: any = {
      name: body.name,
      parentId: body.parentId,
    };

    if (body.ownerScope === 'group' && body.groupId) {
      data.groupId = body.groupId;
      data.ownerId = null;
    } else {
      data.ownerId = req.user?.id;
      data.groupId = null;
    }

    return this.prisma.folder.create({ data });
  }

  @Patch(':id')
  async rename(@Param('id') id: string, @Body() body: RenameFolderDto, @Request() req: any) {
    const folder = await this.prisma.folder.findUnique({ where: { id } });
    if (!folder) throw new ForbiddenException('Dossier introuvable');

    const isAdmin = req.user?.role === 'admin';
    const canEdit = isAdmin || folder.ownerId === req.user?.id;
    if (!canEdit) throw new ForbiddenException('Accès refusé');

    return this.prisma.folder.update({ where: { id }, data: { name: body.name } });
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req: any) {
    const folder = await this.prisma.folder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('Dossier introuvable');

    const isAdmin = req.user?.role === 'admin';
    const canEdit = isAdmin || folder.ownerId === req.user?.id;
    if (!canEdit) throw new ForbiddenException('Accès refusé');

    // Detach documents and templates before deleting (move to root)
    await this.prisma.document.updateMany({ where: { folderId: id }, data: { folderId: null } });
    await this.prisma.template.updateMany({ where: { folderId: id }, data: { folderId: null } });

    await this.prisma.folder.delete({ where: { id } });
    return { deleted: true };
  }

  @Patch(':id/move-document')
  async moveDocument(@Param('id') folderId: string, @Body() body: MoveItemDto, @Request() req: any) {
    const doc = await this.prisma.document.findUnique({ where: { id: body.documentId } });
    if (!doc) throw new ForbiddenException('Document introuvable');

    const isAdmin = req.user?.role === 'admin';
    const canEdit = isAdmin || doc.ownerId === req.user?.id;
    if (!canEdit) throw new ForbiddenException('Accès refusé');

    return this.prisma.document.update({ where: { id: body.documentId }, data: { folderId } });
  }

  @Patch(':id/move-template')
  async moveTemplate(@Param('id') folderId: string, @Body() body: MoveTemplateDto, @Request() req: any) {
    const tpl = await this.prisma.template.findUnique({ where: { id: body.templateId } });
    if (!tpl) throw new ForbiddenException('Template introuvable');

    const isAdmin = req.user?.role === 'admin';
    const canEdit = isAdmin || tpl.ownerId === req.user?.id;
    if (!canEdit) throw new ForbiddenException('Accès refusé');

    return this.prisma.template.update({ where: { id: body.templateId }, data: { folderId } });
  }
}
