import { promises as fs } from 'fs';
import { join } from 'path';
import type { RolePermissions } from './permission-matrix';
import type { ExportSettings } from '../export/export-types';
import { defaultExportSettings } from '../export/export-types';

export type LdapRoleMapping = {
  groupDn: string;
  role: 'admin' | 'editor' | 'viewer';
};

export type LdapGroupMapping = {
  groupDn: string;
  internalGroupName: string;
};

export type MfaPolicy = 'disabled' | 'optional' | 'required';

export type MfaSettings = {
  policy: MfaPolicy;
};

export type RuntimeAdminSettings = {
  storage: {
    provider: 'garage' | 's3';
    endpoint: string;
    bucket: string;
    region?: string;
    forcePathStyle?: boolean;
  };
  auth: {
    mode: 'local' | 'ldap' | 'hybrid';
    allowLocalAdminFallback: boolean;
    autoProvisionUsers: boolean;
  };
  mfa: MfaSettings;
  ldap: {
    enabled: boolean;
    url?: string;
    bindDn?: string;
    bindPassword?: string;
    searchBase?: string;
    searchFilter?: string;
    adminGroup?: string;
    editorGroup?: string;
    roleMappings?: LdapRoleMapping[];
    groupMappings?: LdapGroupMapping[];
    syncGroupMembership?: boolean;
  };
  organization: {
    mode: 'personal' | 'team' | 'directory-managed';
    defaultOwnership: 'user' | 'group';
    allowUserGroups: boolean;
    allowSharedFolders: boolean;
  };
  governance: {
    adminGroupName: string;
    retentionDays: number;
    allowExternalSharing: boolean;
  };
  permissions: {
    admin: Partial<RolePermissions>;
    editor: Partial<RolePermissions>;
    viewer: Partial<RolePermissions>;
  };
  export: ExportSettings;
};

const SETTINGS_PATH = join(process.cwd(), 'config', 'admin-settings.json');

export function defaultRuntimeSettings(): RuntimeAdminSettings {
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
      searchFilter: process.env.LDAP_SEARCH_FILTER || '(sAMAccountName={{username}})',
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
      admin: {},
      editor: {},
      viewer: {},
    },
    export: defaultExportSettings(),
  };
}

export async function loadRuntimeSettings(): Promise<RuntimeAdminSettings> {
  const base = defaultRuntimeSettings();
  try {
    const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
    const json = JSON.parse(raw) as Partial<RuntimeAdminSettings>;
    return {
      storage: { ...base.storage, ...(json.storage || {}) },
      auth: { ...base.auth, ...(json.auth || {}) },
      mfa: { ...base.mfa, ...(json.mfa || {}) },
      ldap: { ...base.ldap, ...(json.ldap || {}) },
      organization: { ...base.organization, ...(json.organization || {}) },
      governance: { ...base.governance, ...(json.governance || {}) },
      permissions: {
        admin: { ...base.permissions.admin, ...(json.permissions?.admin || {}) },
        editor: { ...base.permissions.editor, ...(json.permissions?.editor || {}) },
        viewer: { ...base.permissions.viewer, ...(json.permissions?.viewer || {}) },
      },
      export: {
        ...base.export,
        ...(json.export || {}),
        allowedRoots: json.export?.allowedRoots ?? base.export.allowedRoots,
        destinations: json.export?.destinations ?? base.export.destinations,
        rules: json.export?.rules ?? base.export.rules,
      },
    };
  } catch {
    return base;
  }
}
