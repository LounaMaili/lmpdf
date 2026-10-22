import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Request } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { CreateFolderDto, RenameFolderDto, MoveItemDto, MoveTemplateDto } from './folders/dto/folder.dto';

@Controller('folders')
export class FoldersController {
  constructor(private readonly prisma: PrismaService) {}

  private async requireGroupAccess(groupId: string, user: { id: string; role: string }) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Groupe introuvable');
    if (user.role === 'admin') return;
    const member = await this.prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: user.id, groupId } },
    });
    if (!member) throw new ForbiddenException('Accès refusé au groupe');
  }

  private async requireFolderAccess(id: string, user: { id: string; role: string }) {
    const folder = await this.prisma.folder.findUnique({ where: { id } });
    if (!folder) throw new NotFoundException('Dossier introuvable');
    if (user.role === 'admin' || folder.ownerId === user.id) return folder;
    if (!folder.groupId) throw new ForbiddenException('Accès refusé au dossier');
    await this.requireGroupAccess(folder.groupId, user);
    return folder;
  }

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

    if (body.ownerScope === 'group') {
      if (!body.groupId) throw new BadRequestException('groupId requis pour un dossier de groupe');
      await this.requireGroupAccess(body.groupId, req.user);
      data.groupId = body.groupId;
      data.ownerId = null;
    } else {
      if (body.groupId) throw new BadRequestException('Un dossier personnel ne peut pas avoir de groupe');
      data.ownerId = req.user?.id;
      data.groupId = null;
    }

    if (body.parentId) {
      const parent = await this.requireFolderAccess(body.parentId, req.user);
      if (parent.groupId !== data.groupId || parent.ownerId !== data.ownerId) {
        throw new BadRequestException('Le parent doit appartenir au même propriétaire ou groupe');
      }
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
    if (!doc) throw new NotFoundException('Document introuvable');

    const isAdmin = req.user?.role === 'admin';
    const canEdit = isAdmin || doc.ownerId === req.user?.id;
    if (!canEdit) throw new ForbiddenException('Accès refusé');

    await this.requireFolderAccess(folderId, req.user);
    return this.prisma.document.update({ where: { id: body.documentId }, data: { folderId } });
  }

  @Patch(':id/move-template')
  async moveTemplate(@Param('id') folderId: string, @Body() body: MoveTemplateDto, @Request() req: any) {
    const tpl = await this.prisma.template.findUnique({ where: { id: body.templateId } });
    if (!tpl) throw new NotFoundException('Template introuvable');

    const isAdmin = req.user?.role === 'admin';
    const canEdit = isAdmin || tpl.ownerId === req.user?.id;
    if (!canEdit) throw new ForbiddenException('Accès refusé');

    await this.requireFolderAccess(folderId, req.user);
    return this.prisma.template.update({ where: { id: body.templateId }, data: { folderId } });
  }
}
