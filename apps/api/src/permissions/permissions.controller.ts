import { Body, Controller, Delete, Get, Param, Post, Request } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { ShareDocumentDto, RevokeShareDto } from './dto/share.dto';

@Controller('documents/:docId/permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  /** List all permissions on a document */
  @Get()
  list(@Param('docId') docId: string, @Request() req: any) {
    return this.permissionsService.listPermissions(docId, req.user);
  }

  /** Share a document with a user or group */
  @Post()
  share(@Param('docId') docId: string, @Body() body: ShareDocumentDto, @Request() req: any) {
    return this.permissionsService.share(docId, req.user, body.userId, body.groupId, body.docRole as any);
  }

  /** Revoke a share */
  @Delete()
  revoke(@Param('docId') docId: string, @Body() body: RevokeShareDto, @Request() req: any) {
    return this.permissionsService.revoke(docId, req.user, body.userId, body.groupId);
  }

  /** Get current user's effective role on this document */
  @Get('me')
  async myRole(@Param('docId') docId: string, @Request() req: any) {
    const role = await this.permissionsService.resolveDocRole(docId, req.user);
    return { documentId: docId, docRole: role };
  }
}
