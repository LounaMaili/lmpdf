import { IsObject, IsOptional, IsString, IsArray, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class FieldStyleDto {
  @IsOptional()
  @IsObject()
  [key: string]: any;
}

class DraftFieldDto {
  @IsString()
  id!: string;

  @IsString()
  label!: string;

  @IsString()
  @IsOptional()
  value?: string;

  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;

  @IsNumber()
  w!: number;

  @IsNumber()
  h!: number;

  @IsString()
  type!: string;

  @IsOptional()
  style?: FieldStyleDto;

  @IsOptional()
  locked?: boolean;

  @IsOptional()
  overlayVisible?: boolean;

  @IsOptional()
  @IsNumber()
  pageNumber?: number;
}

class DraftPayloadDto {
  @IsString()
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftFieldDto)
  fields!: DraftFieldDto[];

  @IsNumber()
  rotation!: number;

  @IsNumber()
  pageCount!: number;

  @IsOptional()
  @IsObject()
  preset?: Record<string, unknown>;
}

export class UpsertDraftDto {
  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  sourceFileId?: string;

  @ValidateNested()
  @Type(() => DraftPayloadDto)
  payload!: DraftPayloadDto;
}
