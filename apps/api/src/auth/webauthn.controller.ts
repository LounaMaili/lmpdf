import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WebAuthnService } from './webauthn.service';
import { PrismaService } from '../prisma/prisma.service';
import { compareSync } from 'bcryptjs';

@Controller('auth/webauthn')
export class WebAuthnController {
  constructor(
    private readonly webauthn: WebAuthnService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /auth/webauthn/credentials — Liste les clés WebAuthn de l'utilisateur
   */
  @Get('credentials')
  async listCredentials(@Request() req: any) {
    return this.webauthn.listCredentials(req.user.id);
  }

  /**
   * POST /auth/webauthn/register/begin — Démarre l'enrôlement d'une clé WebAuthn
   * Body: { password: string } (confirmation du mot de passe)
   */
  @Post('register/begin')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async beginRegistration(@Request() req: any, @Body() body: { password: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new UnauthorizedException();

    // WebAuthn uniquement pour les comptes locaux en V2
    if (user.authSource !== 'local') {
      throw new ForbiddenException('WebAuthn disponible uniquement pour les comptes locaux');
    }

    // Vérifier le mot de passe — message générique pour éviter l'énumération
    if (!body.password || !user.passwordHash || !compareSync(body.password, user.passwordHash)) {
      throw new UnauthorizedException('Vérification échouée');
    }

    const options = await this.webauthn.beginRegistration(user.id, user.email);
    return options;
  }

  /**
   * POST /auth/webauthn/register/finish — Finalise l'enrôlement
   * Body: { response: RegistrationResponseJSON, label?: string }
   */
  @Post('register/finish')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async finishRegistration(
    @Request() req: any,
    @Body() body: { response: any; label?: string },
  ) {
    if (!body.response) {
      throw new BadRequestException('Réponse WebAuthn manquante');
    }

    const result = await this.webauthn.finishRegistration(
      req.user.id,
      body.response,
      body.label,
    );

    if (!result.success) {
      throw new BadRequestException(result.error || 'Enregistrement échoué');
    }

    return { success: true, credentialId: result.credentialId };
  }

  /**
   * DELETE /auth/webauthn/credentials/:id — Supprime une clé
   */
  @Delete('credentials/:id')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async deleteCredential(@Request() req: any, @Param('id') id: string) {
    const deleted = await this.webauthn.deleteCredential(req.user.id, id);
    if (!deleted) throw new BadRequestException('Clé introuvable');
    return { success: true };
  }

  /**
   * PATCH /auth/webauthn/credentials/:id — Renomme une clé
   * Body: { label: string }
   */
  @Patch('credentials/:id')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async renameCredential(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { label: string },
  ) {
    if (!body.label?.trim()) {
      throw new BadRequestException('Label requis');
    }
    const renamed = await this.webauthn.renameCredential(req.user.id, id, body.label.trim());
    if (!renamed) throw new BadRequestException('Clé introuvable');
    return { success: true };
  }
}
