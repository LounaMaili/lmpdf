"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultRuntimeSettings = defaultRuntimeSettings;
exports.loadRuntimeSettings = loadRuntimeSettings;
const fs_1 = require("fs");
const path_1 = require("path");
const export_types_1 = require("../export/export-types");
const SETTINGS_PATH = (0, path_1.join)(process.cwd(), 'config', 'admin-settings.json');
function defaultRuntimeSettings() {
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
            mode: process.env.AUTH_MODE || (ldapEnabled ? 'hybrid' : 'local'),
            allowLocalAdminFallback: (process.env.AUTH_ALLOW_LOCAL_ADMIN_FALLBACK || 'true') === 'true',
            autoProvisionUsers: (process.env.AUTH_AUTO_PROVISION_USERS || 'true') === 'true',
        },
        mfa: {
            policy: process.env.MFA_POLICY || 'optional',
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
            mode: process.env.ORGANIZATION_MODE || 'team',
            defaultOwnership: process.env.ORGANIZATION_DEFAULT_OWNERSHIP || 'user',
            allowUserGroups: (process.env.ORGANIZATION_ALLOW_USER_GROUPS || 'true') === 'true',
            allowSharedFolders: (process.env.ORGANIZATION_ALLOW_SHARED_FOLDERS || 'true') === 'true',
        },
        permissions: {
            admin: {},
            editor: {},
            viewer: {},
        },
        export: (0, export_types_1.defaultExportSettings)(),
    };
}
async function loadRuntimeSettings() {
    const base = defaultRuntimeSettings();
    try {
        const raw = await fs_1.promises.readFile(SETTINGS_PATH, 'utf8');
        const json = JSON.parse(raw);
        return {
            storage: { ...base.storage, ...(json.storage || {}) },
            auth: { ...base.auth, ...(json.auth || {}) },
            mfa: { ...base.mfa, ...(json.mfa || {}) },
            ldap: { ...base.ldap, ...(json.ldap || {}) },
            organization: { ...base.organization, ...(json.organization || {}) },
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
    }
    catch {
        return base;
    }
}
//# sourceMappingURL=runtime-settings.js.map