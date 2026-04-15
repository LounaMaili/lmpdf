import { Body, Controller, Post, Get, Request, UnauthorizedException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { hash, compare } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LdapService } from './ldap.service';
import { MfaService } from './mfa.service';
import { WebAuthnService } from './webauthn.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';
import { resolveRolePermissions } from '../config/permission-matrix';
import { loadRuntimeSettings } from '../config/runtime-settings';

// Messages d'erreur normalisés — anti-enumération
const AUTH_FAIL = 'Identifiants invalides';
const PASSWORDLESS_FAIL = 'Connexion par passkey non disponible';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly ldap: LdapService,
    private readonly mfa: MfaService,
    private readonly webauthn: WebAuthnService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register')
  async register(@Body() body: RegisterDto) {
    const settings = await loadRuntimeSettings();
    const allowSelfRegister = (process.env.ALLOW_SELF_REGISTER || 'false') === 'true';
    if (settings.auth.mode === 'ldap') throw new ForbiddenException('Inscription locale désactivée en mode LDAP');
    if (!allowSelfRegister) throw new ForbiddenException('Inscription désactivée');
    const exists = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw new ConflictException('Email déjà utilisé');

    // First user becomes admin
    const userCount = await this.prisma.user.count();
    const role = userCount === 0 ? 'admin' : 'editor';

    const user = await this.prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hash(body.password, 10),
        displayName: body.displayName,
        role: role as any,
        authSource: 'local',
      },
    });

    const token = this.signToken(user);
    return {
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() body: LoginDto) {
    const settings = await loadRuntimeSettings();
    const useLdap = settings.auth.mode === 'ldap' || settings.auth.mode === 'hybrid';
    const allowLocal = settings.auth.mode === 'local' || (settings.auth.mode === 'hybrid' && settings.auth.allowLocalAdminFallback);

    if (useLdap && this.ldap.enabled) {
      const ldapResult = await this.tryLdapLogin(body.email, body.password);
      if (ldapResult) return ldapResult;
      if (settings.auth.mode === 'ldap') throw new UnauthorizedException('Identifiants invalides');
    }

    if (!allowLocal) throw new UnauthorizedException('Authentification locale désactivée');

    // Fallback to local auth
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.isActive) throw new UnauthorizedException('Identifiants invalides');

    if (!user.passwordHash) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    try {
      if (!(await compare(body.password, user.passwordHash))) {
        throw new UnauthorizedException('Identifiants invalides');
      }
    } catch {
      throw new UnauthorizedException('Identifiants invalides');
    }

    // ── MFA / WebAuthn challenge ──
    const hasWebauthn = await this.webauthn.hasCredentials(user.id);
    if ((user.mfaEnabled && user.mfaSecret) || hasWebauthn) {
      // Retourner un challenge MFA au lieu du token
      const mfaChallengeToken = this.jwtService.sign(
        { sub: user.id, email: user.email, role: user.role, mfaChallenge: true },
        { expiresIn: '2m' },
      );
      
      let webauthnOptions = null;
      if (hasWebauthn) {
        webauthnOptions = await this.webauthn.beginAuthentication(user.id);
      }

      return {
        mfaRequired: true,
        mfaChallengeToken,
        webauthnOptions,
        user: { id: user.id, email: user.email, displayName: user.displayName },
      };
    }

    // ── MFA policy check : si required et pas de MFA activé ──
    const mfaPolicy = settings.mfa?.policy ?? 'optional';
    const mfaSetupRequired = mfaPolicy === 'required' && !user.mfaEnabled && !hasWebauthn && user.authSource === 'local';

    const token = this.signToken(user);
    return {
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
      mfaSetupRequired,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/mfa-verify')
  async loginMfaVerify(@Body() body: { mfaChallengeToken: string; code: string }) {
    // Message d'erreur uniforme pour toutes les étapes
    const MFA_FAIL = 'Vérification MFA échouée';

    if (!body.mfaChallengeToken || !body.code) {
      throw new UnauthorizedException(MFA_FAIL);
    }

    // Vérifier le challenge token
    let payload: { sub: string; email: string; role: string; mfaChallenge?: boolean };
    try {
      payload = this.jwtService.verify(body.mfaChallengeToken);
    } catch {
      throw new UnauthorizedException(MFA_FAIL);
    }

    if (!payload.mfaChallenge) {
      throw new UnauthorizedException(MFA_FAIL);
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.mfaEnabled) {
      throw new UnauthorizedException(MFA_FAIL);
    }

    // Essayer d'abord comme code TOTP, puis comme backup code
    const code = body.code.trim();
    let valid = await this.mfa.verifyUserTotp(user.id, code);
    if (!valid) {
      valid = await this.mfa.verifyBackupCode(user.id, code);
    }

    if (!valid) {
      throw new UnauthorizedException(MFA_FAIL);
    }

    const token = this.signToken(user);
    return {
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/webauthn-verify')
  async loginWebauthnVerify(@Body() body: { mfaChallengeToken: string; response: any }) {
    const WEBAUTHN_FAIL = 'Vérification WebAuthn échouée';

    if (!body.mfaChallengeToken || !body.response) {
      throw new UnauthorizedException(WEBAUTHN_FAIL);
    }

    let payload: { sub: string; email: string; role: string; mfaChallenge?: boolean };
    try {
      payload = this.jwtService.verify(body.mfaChallengeToken);
    } catch {
      throw new UnauthorizedException(WEBAUTHN_FAIL);
    }

    if (!payload.mfaChallenge) {
      throw new UnauthorizedException(WEBAUTHN_FAIL);
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException(WEBAUTHN_FAIL);
    }

    const valid = await this.webauthn.finishAuthentication(user.id, body.response);
    if (!valid) {
      throw new UnauthorizedException(WEBAUTHN_FAIL);
    }

    const token = this.signToken(user);
    return {
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
    };
  }

  // ─── V3: Passwordless WebAuthn Login ─────────────────────────────────────

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/passwordless-begin')
  async passwordlessBegin(@Body() body: { email: string }) {
    if (!body.email?.trim()) {
      throw new UnauthorizedException(PASSWORDLESS_FAIL);
    }

    const settings = await loadRuntimeSettings();
    const allowLocal = settings.auth.mode === 'local' || (settings.auth.mode === 'hybrid' && settings.auth.allowLocalAdminFallback);
    if (!allowLocal) {
      throw new UnauthorizedException(PASSWORDLESS_FAIL);
    }

    const result = await this.webauthn.beginPasswordlessAuthentication(body.email.trim());
    if (!result) {
      // Ne pas révéler si l'email existe ou non — retour générique
      throw new UnauthorizedException(PASSWORDLESS_FAIL);
    }

    return { options: result.options };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/passwordless-finish')
  async passwordlessFinish(@Body() body: { email: string; response: any }) {
    if (!body.email?.trim() || !body.response) {
      throw new UnauthorizedException(PASSWORDLESS_FAIL);
    }

    const user = await this.webauthn.finishPasswordlessAuthentication(
      body.email.trim(),
      body.response,
    );

    if (!user) {
      throw new UnauthorizedException(PASSWORDLESS_FAIL);
    }

    const token = this.signToken(user);
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        authSource: user.authSource,
        externalId: user.externalId,
      },
    };
  }

  @Get('me')
  async me(@Request() req: any) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new UnauthorizedException();
    const settings = await loadRuntimeSettings();
    const mfaPolicy = settings.mfa?.policy ?? 'optional';
    const hasWebauthn = await this.webauthn.hasCredentials(user.id);
    return {
      id: user.id, email: user.email, displayName: user.displayName, role: user.role,
      authSource: user.authSource, externalId: user.externalId,
      mfaEnabled: user.mfaEnabled,
      hasWebauthn,
      mfaPolicy,
    };
  }

  @Get('permissions')
  async permissions(@Request() req: any) {
    return resolveRolePermissions(req.user?.role);
  }

  @Public()
  @Get('auth-methods')
  async authMethods() {
    const settings = await loadRuntimeSettings();
    return {
      mode: settings.auth.mode,
      local: settings.auth.mode !== 'ldap',
      ldap: this.ldap.enabled && settings.auth.mode !== 'local',
      allowLocalAdminFallback: settings.auth.allowLocalAdminFallback,
      autoProvisionUsers: settings.auth.autoProvisionUsers,
    };
  }

  // ─── Private helpers ────────────────────────────────────────

  private async tryLdapLogin(emailOrUsername: string, password: string) {
    // Extract username from email if needed (user@domain → user)
    const username = emailOrUsername.includes('@')
      ? emailOrUsername.split('@')[0]
      : emailOrUsername;

    const ldapUser = await this.ldap.authenticate(username, password);
    if (!ldapUser) return null;

    const role = await this.ldap.resolveRole(ldapUser.memberOf);
    const settings = await loadRuntimeSettings();

    // Find or create user in local DB
    let user = await this.prisma.user.findUnique({ where: { email: ldapUser.email } });

    if (!user && !settings.auth.autoProvisionUsers) {
      return null;
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: ldapUser.email,
          passwordHash: '', // no local password for AD users
          displayName: ldapUser.displayName,
          role: role as any,
          authSource: 'ldap',
          externalId: ldapUser.email || username,
          externalDn: ldapUser.dn,
        },
      });
    } else {
      // Sync display name and role from AD on each login
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          displayName: ldapUser.displayName,
          role: role as any,
          isActive: true,
          authSource: 'ldap',
          externalId: ldapUser.email || username,
          externalDn: ldapUser.dn,
        },
      });
    }

    // ── Phase 2: Sync internal group memberships from AD groupMappings ──
    await this.syncGroupMemberships(user.id, ldapUser.memberOf);

    const token = this.signToken(user);
    return {
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
      authMethod: 'ldap',
    };
  }

  /**
   * Synchronise l'appartenance aux groupes internes LMPdf en fonction des groupMappings AD.
   * - Crée les groupes internes s'ils n'existent pas (org group, createdById=null)
   * - Ajoute l'utilisateur aux groupes mappés
   * - Retire l'utilisateur des groupes mappés dont il n'est plus membre AD
   *   (ne touche pas aux groupes non mappés / créés manuellement)
   */
  private async syncGroupMemberships(userId: string, memberOf: string[]) {
    try {
      const syncEnabled = await this.ldap.isSyncGroupMembershipEnabled();
      if (!syncEnabled) return;

      const mappedGroupNames = await this.ldap.resolveGroupMappings(memberOf);
      if (mappedGroupNames.length === 0) {
        // Si des mappings sont configurés, retirer l'utilisateur des groupes mappés
        const settings = await loadRuntimeSettings();
        const allMappedNames = (settings.ldap.groupMappings || []).map((m) => m.internalGroupName);
        if (allMappedNames.length > 0) {
          // Trouver les groupes mappés dont l'utilisateur est encore membre
          const toRemove = await this.prisma.groupMember.findMany({
            where: {
              userId,
              group: { name: { in: allMappedNames } },
            },
          });
          if (toRemove.length > 0) {
            await this.prisma.groupMember.deleteMany({
              where: { id: { in: toRemove.map((m) => m.id) } },
            });
          }
        }
        return;
      }

      // Ensure all mapped groups exist (create as org groups if missing)
      for (const groupName of mappedGroupNames) {
        const existing = await this.prisma.group.findUnique({ where: { name: groupName } });
        if (!existing) {
          await this.prisma.group.create({
            data: { name: groupName, description: `Groupe synchronisé depuis AD`, createdById: null },
          });
        }
      }

      // Get all mapped internal groups
      const mappedGroups = await this.prisma.group.findMany({
        where: { name: { in: mappedGroupNames } },
      });
      const mappedGroupIds = mappedGroups.map((g) => g.id);

      // Get current memberships of this user in mapped groups
      const settings = await loadRuntimeSettings();
      const allMappedNames = (settings.ldap.groupMappings || []).map((m) => m.internalGroupName);
      const allMappedGroups = await this.prisma.group.findMany({
        where: { name: { in: allMappedNames } },
      });
      const allMappedGroupIds = allMappedGroups.map((g) => g.id);

      const currentMemberships = await this.prisma.groupMember.findMany({
        where: { userId, groupId: { in: allMappedGroupIds } },
      });
      const currentGroupIds = currentMemberships.map((m) => m.groupId);

      // Add to new groups
      const toAdd = mappedGroupIds.filter((gid) => !currentGroupIds.includes(gid));
      for (const groupId of toAdd) {
        await this.prisma.groupMember.create({
          data: { userId, groupId, role: 'editor' },
        }).catch(() => { /* already exists, ignore */ });
      }

      // Remove from groups no longer matched
      const toRemove = currentGroupIds.filter((gid) => !mappedGroupIds.includes(gid));
      if (toRemove.length > 0) {
        await this.prisma.groupMember.deleteMany({
          where: { userId, groupId: { in: toRemove } },
        });
      }
    } catch (err: any) {
      // Non-blocking: log but don't fail login
      this.logger.error(`[syncGroupMemberships] Error: ${err.message}`);
    }
  }

  private signToken(user: { id: string; email: string; role: string }) {
    return this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
  }
}
