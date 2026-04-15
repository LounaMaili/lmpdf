import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenameTemplateDto {
  @IsString()
  @MinLength(1, { message: 'Le nom ne peut pas être vide' })
  @MaxLength(200, { message: 'Le nom est trop long (200 caractères max)' })
  name!: string;
}
