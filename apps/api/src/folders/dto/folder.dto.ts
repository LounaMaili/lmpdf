import { IsOptional, IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsUUID()
  @IsOptional()
  parentId?: string;

  @IsOptional()
  @IsString()
  ownerScope?: 'me' | 'group';

  @IsUUID()
  @IsOptional()
  groupId?: string;
}

export class RenameFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}

export class MoveItemDto {
  @IsUUID()
  documentId!: string;
}

export class MoveTemplateDto {
  @IsUUID()
  templateId!: string;
}
