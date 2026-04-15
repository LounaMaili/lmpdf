import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Request } from '@nestjs/common';
import { CreateTemplateDto } from './dto/create-template.dto';
import { RenameTemplateDto } from './dto/rename-template.dto';
import { TemplatesService } from './templates.service';
import { canUser } from '../config/permission-matrix';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  async create(@Body() body: CreateTemplateDto, @Request() req: any) {
    if (!(await canUser(req.user?.role, 'createTemplate'))) {
      throw new ForbiddenException('Droits insuffisants pour créer un template');
    }
    return this.templatesService.create(body, req.user);
  }

  @Get()
  list(@Request() req: any) {
    return this.templatesService.list(req.user);
  }

  @Get(':id')
  get(@Param('id') id: string, @Request() req: any) {
    return this.templatesService.get(id, req.user);
  }

  @Patch(':id')
  async rename(@Param('id') id: string, @Body() body: RenameTemplateDto, @Request() req: any) {
    if (!(await canUser(req.user?.role, 'manageTemplate'))) {
      throw new ForbiddenException('Droits insuffisants pour renommer un template');
    }
    return this.templatesService.rename(id, body.name, req.user);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req: any) {
    if (!(await canUser(req.user?.role, 'manageTemplate'))) {
      throw new ForbiddenException('Droits insuffisants pour supprimer un template');
    }
    return this.templatesService.delete(id, req.user);
  }
}
