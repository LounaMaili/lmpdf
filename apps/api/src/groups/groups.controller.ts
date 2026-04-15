import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('groups')
export class GroupsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List groups visible to the current user:
   * - Admin: all groups
   * - Others: org groups (createdById = null) they belong to + their personal groups
   */
  @Get()
  async list(@Request() req: any) {
    if (req.user.role === 'admin') {
      return this.prisma.group.findMany({
        include: { _count: { select: { members: true } } },
        orderBy: { name: 'asc' },
      });
    }
    return this.prisma.group.findMany({
      where: {
        OR: [
          { members: { some: { userId: req.user.id } } },
          { createdById: req.user.id },
        ],
      },
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create a group.
   * - Admin: creates org group (createdById = null) by default, or personal if requested
   * - Others: always creates personal group (createdById = their id)
   */
  @Post()
  async create(@Body() body: { name: string; description?: string; personal?: boolean }, @Request() req: any) {
    const isAdmin = req.user.role === 'admin';
    const createdById = (isAdmin && !body.personal) ? null : req.user.id;

    return this.prisma.group.create({
      data: {
        name: body.name,
        description: body.description,
        createdById,
      },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Request() req: any) {
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, displayName: true } } },
        },
      },
    });
    if (!group) throw new NotFoundException('Groupe introuvable');

    // Check access: admin, creator, or member
    const isAdmin = req.user.role === 'admin';
    const isCreator = group.createdById === req.user.id;
    const isMember = group.members.some((m: any) => m.userId === req.user.id);
    if (!isAdmin && !isCreator && !isMember) throw new ForbiddenException('Accès refusé');

    return group;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; description?: string }, @Request() req: any) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Groupe introuvable');

    const isAdmin = req.user.role === 'admin';
    const isCreator = group.createdById === req.user.id;
    if (!isAdmin && !isCreator) throw new ForbiddenException('Seul le créateur ou un admin peut modifier ce groupe');

    return this.prisma.group.update({
      where: { id },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
      },
    });
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req: any) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Groupe introuvable');

    const isAdmin = req.user.role === 'admin';
    const isCreator = group.createdById === req.user.id;
    if (!isAdmin && !isCreator) throw new ForbiddenException('Seul le créateur ou un admin peut supprimer ce groupe');

    await this.prisma.group.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Members ──

  @Post(':id/members')
  async addMember(@Param('id') groupId: string, @Body() body: { userId: string; role?: string }, @Request() req: any) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Groupe introuvable');

    const isAdmin = req.user.role === 'admin';
    const isCreator = group.createdById === req.user.id;
    if (!isAdmin && !isCreator) throw new ForbiddenException('Seul le créateur ou un admin peut ajouter des membres');

    return this.prisma.groupMember.create({
      data: {
        groupId,
        userId: body.userId,
        role: (body.role as any) || 'editor',
      },
    });
  }

  @Delete(':id/members/:userId')
  async removeMember(@Param('id') groupId: string, @Param('userId') userId: string, @Request() req: any) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Groupe introuvable');

    const isAdmin = req.user.role === 'admin';
    const isCreator = group.createdById === req.user.id;
    if (!isAdmin && !isCreator) throw new ForbiddenException('Seul le créateur ou un admin peut retirer des membres');

    await this.prisma.groupMember.deleteMany({ where: { groupId, userId } });
    return { removed: true };
  }
}
