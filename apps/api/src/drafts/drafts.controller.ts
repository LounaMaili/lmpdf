import { Body, Controller, Delete, Get, HttpCode, Put, Query, Request } from '@nestjs/common';
import { DraftsService } from './drafts.service';
import { UpsertDraftDto } from './dto/draft.dto';

@Controller('drafts')
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  /**
   * PUT /api/drafts – Upsert autosave draft (single slot per user+key).
   * Body: { templateId?, sourceFileId?, payload: { name, fields, rotation, pageCount, ... } }
   */
  @Put()
  @HttpCode(200)
  async upsert(
    @Body() body: UpsertDraftDto,
    @Request() req: any,
  ) {
    const userId = req.user.id;
    const key = { templateId: body.templateId, sourceFileId: body.sourceFileId };
    return this.draftsService.upsert(userId, key, body.payload);
  }

  /**
   * GET /api/drafts?templateId=xxx  or  GET /api/drafts?sourceFileId=xxx
   */
  @Get()
  async get(
    @Query('templateId') templateId?: string,
    @Query('sourceFileId') sourceFileId?: string,
    @Request() req?: any,
  ) {
    const userId = req.user.id;
    const draft = await this.draftsService.get(userId, { templateId, sourceFileId });
    if (!draft) return { draft: null };
    return { draft };
  }

  /**
   * DELETE /api/drafts?templateId=xxx  or  DELETE /api/drafts?sourceFileId=xxx
   */
  @Delete()
  @HttpCode(200)
  async clear(
    @Query('templateId') templateId?: string,
    @Query('sourceFileId') sourceFileId?: string,
    @Request() req?: any,
  ) {
    const userId = req.user.id;
    return this.draftsService.clear(userId, { templateId, sourceFileId });
  }
}
