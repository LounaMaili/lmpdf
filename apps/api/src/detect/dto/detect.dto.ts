import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class DetectDto {
  @IsUUID()
  @IsOptional()
  documentId?: string;

  @IsObject()
  @IsOptional()
  options?: Record<string, unknown>;
}
