import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  Max,
  MinLength,
  ValidateNested,
} from 'class-validator';

class FieldDto {
  @IsUUID()
  @IsOptional()
  id?: string;

  @IsString()
  @MaxLength(200)
  label!: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  value?: string;

  @IsObject()
  @IsOptional()
  style?: Record<string, unknown>;

  @IsNumber()
  @Min(0)
  @Max(10000)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(10000)
  y!: number;

  @IsNumber()
  @Min(1)
  @Max(10000)
  w!: number;

  @IsNumber()
  @Min(1)
  @Max(10000)
  h!: number;

  @IsIn(['text', 'checkbox', 'counter-tally', 'counter-numeric', 'date'])
  type!: 'text' | 'checkbox' | 'counter-tally' | 'counter-numeric' | 'date';

  @IsBoolean()
  @IsOptional()
  locked?: boolean;

  @IsBoolean()
  @IsOptional()
  overlayVisible?: boolean;

  @IsNumber()
  @Min(1)
  @Max(2000)
  @IsOptional()
  pageNumber?: number;
}

export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsUUID()
  @IsOptional()
  sourceFileId?: string;

  @IsNumber()
  @IsIn([0, 90, 180, 270])
  @IsOptional()
  rotation?: number;

  @IsArray()
  @ArrayMaxSize(500, { message: 'Maximum 500 champs par template' })
  @ValidateNested({ each: true })
  @Type(() => FieldDto)
  fields!: FieldDto[];
}
