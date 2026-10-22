import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ExportRequestDto {
  @IsOptional()
  @IsUUID()
  sourceFileId?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  // Accepted for older clients, but never trusted for authorization or rule matching.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  templateName?: string;

  // Presentation only: never used for permission checks, directories or rule matching.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  outputFileName?: string;
}
