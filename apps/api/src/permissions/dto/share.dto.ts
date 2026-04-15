import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class ShareDocumentDto {
  @IsUUID()
  @IsOptional()
  userId?: string;

  @IsUUID()
  @IsOptional()
  groupId?: string;

  @IsIn(['owner', 'editor', 'filler'])
  docRole!: 'owner' | 'editor' | 'filler';
}

export class RevokeShareDto {
  @IsUUID()
  @IsOptional()
  userId?: string;

  @IsUUID()
  @IsOptional()
  groupId?: string;
}
