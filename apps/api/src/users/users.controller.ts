import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Search users by email or displayName — accessible to all authenticated users */
  @Get('search')
  async search(@Query('q') q?: string) {
    if (!q || q.length < 2) return [];
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

  @Get()
  @Roles('admin')
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

  @Get(':id')
  @Roles('admin')
  async get(@Param('id') id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, displayName: true, role: true, authSource: true, externalId: true, externalDn: true, isActive: true, createdAt: true,
        memberships: { include: { group: { select: { id: true, name: true } } } },
      },
    });
  }

  @Patch(':id')
  @Roles('admin')
  async update(@Param('id') id: string, @Body() body: UpdateUserDto) {
    const data: Record<string, any> = {};
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.role !== undefined) data.role = body.role;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, displayName: true, role: true, authSource: true, externalId: true, isActive: true },
    });
  }

  @Delete(':id')
  @Roles('admin')
  async delete(@Param('id') id: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    return { deactivated: true };
  }
}
