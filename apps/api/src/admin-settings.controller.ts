import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from './prisma/prisma.service';
import { LdapService } from './auth/ldap.service';
import { Roles } from './auth/roles.decorator';
import { loadRuntimeSettings } from './config/runtime-settings';
import type { LdapRoleMapping, LdapGroupMapping, MfaPolicy } from './config/runtime-settings';
import type { RuntimeAdminSettings } from './config/runtime-settings';
import { DEFAULT_ROLE_PERMISSIONS, type RolePermissions } from './config/permission-matrix';
import type { ExportSettings } from './export/export-types';
import { defaultExportSettings } from './export/export-types';

type AdminSettings = RuntimeAdminSettings;

const SETTINGS_PATH = join(process.cwd(), 'config', 'admin-settings.json');

function normalizeSearchFilter(value: string | undefined): string {
  const v = (value || '').trim();
  if (!v) return '(sAMAccountName={{username}})';
  if (!v.includes('{{username}}')) return '(sAMAccountName={{username}})';
  return v;
}

function defaults(): AdminSettings {
  const ldapEnabled = (process.env.LDAP_ENABLED || 'false') === 'true';

  return {
    storage: {
      provider: 'garage',
      endpoint: process.env.S3_ENDPOINT || 'http://garage:3900',
      bucket: process.env.S3_BUCKET || 'lmpdf',
      region: process.env.S3_REGION || 'garage',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
    },
    auth: {
      mode: (process.env.AUTH_MODE as 'local' | 'ldap' | 'hybrid' | undefined) || (ldapEnabled ? 'hybrid' : 'local'),
      allowLocalAdminFallback: (process.env.AUTH_ALLOW_LOCAL_ADMIN_FALLBACK || 'true') === 'true',
      autoProvisionUsers: (process.env.AUTH_AUTO_PROVISION_USERS || 'true') === 'true',
    },
    mfa: {
      policy: (process.env.MFA_POLICY as MfaPolicy | undefined) || 'optional',
    },
    ldap: {
      enabled: ldapEnabled,
      url: process.env.LDAP_URL || '',
      bindDn: process.env.LDAP_BIND_DN || '',
      bindPassword: process.env.LDAP_BIND_PASSWORD || '',
      searchBase: process.env.LDAP_SEARCH_BASE || '',
      searchFilter: normalizeSearchFilter(process.env.LDAP_SEARCH_FILTER),
      adminGroup: process.env.LDAP_ADMIN_GROUP || '',
      editorGroup: process.env.LDAP_EDITOR_GROUP || '',
      roleMappings: [],
      groupMappings: [],
      syncGroupMembership: true,
    },
    organization: {
      mode: (process.env.ORGANIZATION_MODE as 'personal' | 'team' | 'directory-managed' | undefined) || 'team',
      defaultOwnership: (process.env.ORGANIZATION_DEFAULT_OWNERSHIP as 'user' | 'group' | undefined) || 'user',
      allowUserGroups: (process.env.ORGANIZATION_ALLOW_USER_GROUPS || 'true') === 'true',
      allowSharedFolders: (process.env.ORGANIZATION_ALLOW_SHARED_FOLDERS || 'true') === 'true',
    },
    governance: {
      adminGroupName: 'LMPdf-Admins',
      retentionDays: 365,
      allowExternalSharing: false,
    },
    permissions: {
      admin: { ...DEFAULT_ROLE_PERMISSIONS.admin },
      editor: { ...DEFAULT_ROLE_PERMISSIONS.editor },
      viewer: { ...DEFAULT_ROLE_PERMISSIONS.viewer },
    },
    export: defaultExportSettings(),
  };
}

function sanitizeSettingsForClient(settings: AdminSettings): AdminSettings {
  return {
    ...settings,
    ldap: {
      ...settings.ldap,
      bindPassword: settings.ldap.bindPassword ? '********' : '',
    },
  };
}

@Controller('admin/settings')
@Roles('admin')
export class AdminSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ldap: LdapService,
  ) {}

  private async readSettingsInternal(): Promise<AdminSettings> {
    try {
      const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
      const json = JSON.parse(raw) as Partial<AdminSettings>;
      const d = defaults();
      return {
        storage: { ...d.storage, ...(json.storage || {}) },
        auth: { ...d.auth, ...(json.auth || {}) },
        mfa: { ...d.mfa, ...(json.mfa || {}) },
        ldap: { ...d.ldap, ...(json.ldap || {}) },
        organization: { ...d.organization, ...(json.organization || {}) },
        governance: { ...d.governance, ...(json.governance || {}) },
        permissions: {
          admin: { ...d.permissions.admin, ...(json.permissions?.admin || {}) },
          editor: { ...d.permissions.editor, ...(json.permissions?.editor || {}) },
          viewer: { ...d.permissions.viewer, ...(json.permissions?.viewer || {}) },
        },
        export: {
          ...d.export,
          ...(json.export || {}),
          allowedRoots: json.export?.allowedRoots ?? d.export.allowedRoots,
          destinations: json.export?.destinations ?? d.export.destinations,
          rules: json.export?.rules ?? d.export.rules,
        },
      };
    } catch {
      return defaults();
    }
  }

  @Get()
  async getSettings(): Promise<AdminSettings> {
    const settings = await this.readSettingsInternal();
    return sanitizeSettingsForClient(settings);
  }

  @Patch()
  async updateSettings(@Body() body: Partial<AdminSettings>) {
    const current = await this.readSettingsInternal();

    let bindPassword = current.ldap.bindPassword;
    if (body.ldap && typeof body.ldap.bindPassword === 'string') {
      const incoming = body.ldap.bindPassword.trim();
      if (incoming && incoming !== '********') bindPassword = incoming;
    }

    const merged: AdminSettings = {
      storage: { ...current.storage, ...(body.storage || {}) },
      auth: { ...current.auth, ...(body.auth || {}) },
      mfa: { ...current.mfa, ...(body.mfa || {}) },
      ldap: {
        ...current.ldap,
        ...(body.ldap || {}),
        bindPassword,
        searchFilter: normalizeSearchFilter(body.ldap?.searchFilter ?? current.ldap.searchFilter),
      },
      organization: { ...current.organization, ...(body.organization || {}) },
      governance: { ...current.governance, ...(body.governance || {}) },
      permissions: {
        admin: { ...current.permissions.admin, ...(body.permissions?.admin || {}) },
        editor: { ...current.permissions.editor, ...(body.permissions?.editor || {}) },
        viewer: { ...current.permissions.viewer, ...(body.permissions?.viewer || {}) },
      },
      export: {
        ...current.export,
        ...(body.export || {}),
        allowedRoots: body.export?.allowedRoots ?? current.export.allowedRoots,
        destinations: body.export?.destinations ?? current.export.destinations,
        rules: body.export?.rules ?? current.export.rules,
      },
    };

    await fs.mkdir(join(process.cwd(), 'config'), { recursive: true });
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');

    return { ok: true, settings: sanitizeSettingsForClient(merged) };
  }

  @Get('overview')
  async overview() {
    const settings = await loadRuntimeSettings();
    const [users, groups, docs, templates] = await Promise.all([
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.group.count(),
      this.prisma.document.count(),
      this.prisma.template.count(),
    ]);

    return {
      counts: { users, groups, documents: docs, templates },
      authMode: settings.auth.mode,
      organizationMode: settings.organization.mode,
      ldapEnabled: settings.ldap.enabled,
      storageEndpoint: settings.storage.endpoint,
      bucket: settings.storage.bucket,
      defaultPermissions: DEFAULT_ROLE_PERMISSIONS,
      configuredPermissions: settings.permissions,
    };
  }

  @Post('test-storage')
  async testStorage() {
    const settings = await loadRuntimeSettings();
    const endpoint = settings.storage.endpoint;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(endpoint, { method: 'GET', signal: controller.signal as any });
      clearTimeout(timeout);
      return { ok: true, endpoint, status: res.status };
    } catch (e: any) {
      return { ok: false, endpoint, error: e?.message || 'Storage unreachable' };
    }
  }

  @Post('test-ldap')
  async testLdap(@Body() body: { username: string; password: string }) {
    if (!this.ldap.enabled) return { ok: false, error: 'LDAP désactivé (LDAP_ENABLED=false)' };
    const result = await this.ldap.authenticate(body.username, body.password);
    if (!result) return { ok: false, error: 'Échec authentification LDAP' };
    return {
      ok: true,
      user: {
        dn: result.dn,
        email: result.email,
        displayName: result.displayName,
        memberOfCount: result.memberOf.length,
      },
    };
  }
}
