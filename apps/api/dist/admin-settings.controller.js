"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminSettingsController = void 0;
const common_1 = require("@nestjs/common");
const fs_1 = require("fs");
const path_1 = require("path");
const prisma_service_1 = require("./prisma/prisma.service");
const ldap_service_1 = require("./auth/ldap.service");
const roles_decorator_1 = require("./auth/roles.decorator");
const runtime_settings_1 = require("./config/runtime-settings");
const permission_matrix_1 = require("./config/permission-matrix");
const export_types_1 = require("./export/export-types");
const SETTINGS_PATH = (0, path_1.join)(process.cwd(), 'config', 'admin-settings.json');
function normalizeSearchFilter(value) {
    const v = (value || '').trim();
    if (!v)
        return '(sAMAccountName={{username}})';
    if (!v.includes('{{username}}'))
        return '(sAMAccountName={{username}})';
    return v;
}
function defaults() {
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
            searchFilter: normalizeSearchFilter(process.env.LDAP_SEARCH_FILTER),
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
        governance: {
            adminGroupName: 'LMPdf-Admins',
            retentionDays: 365,
            allowExternalSharing: false,
        },
        permissions: {
            admin: { ...permission_matrix_1.DEFAULT_ROLE_PERMISSIONS.admin },
            editor: { ...permission_matrix_1.DEFAULT_ROLE_PERMISSIONS.editor },
            viewer: { ...permission_matrix_1.DEFAULT_ROLE_PERMISSIONS.viewer },
        },
        export: (0, export_types_1.defaultExportSettings)(),
    };
}
function sanitizeSettingsForClient(settings) {
    return {
        ...settings,
        ldap: {
            ...settings.ldap,
            bindPassword: settings.ldap.bindPassword ? '********' : '',
        },
    };
}
let AdminSettingsController = class AdminSettingsController {
    constructor(prisma, ldap) {
        this.prisma = prisma;
        this.ldap = ldap;
    }
    async readSettingsInternal() {
        try {
            const raw = await fs_1.promises.readFile(SETTINGS_PATH, 'utf8');
            const json = JSON.parse(raw);
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
        }
        catch {
            return defaults();
        }
    }
    async getSettings() {
        const settings = await this.readSettingsInternal();
        return sanitizeSettingsForClient(settings);
    }
    async updateSettings(body) {
        const current = await this.readSettingsInternal();
        let bindPassword = current.ldap.bindPassword;
        if (body.ldap && typeof body.ldap.bindPassword === 'string') {
            const incoming = body.ldap.bindPassword.trim();
            if (incoming && incoming !== '********')
                bindPassword = incoming;
        }
        const merged = {
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
        await fs_1.promises.mkdir((0, path_1.join)(process.cwd(), 'config'), { recursive: true });
        await fs_1.promises.writeFile(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
        return { ok: true, settings: sanitizeSettingsForClient(merged) };
    }
    async overview() {
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
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
            defaultPermissions: permission_matrix_1.DEFAULT_ROLE_PERMISSIONS,
            configuredPermissions: settings.permissions,
        };
    }
    async testStorage() {
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const endpoint = settings.storage.endpoint;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(endpoint, { method: 'GET', signal: controller.signal });
            clearTimeout(timeout);
            return { ok: true, endpoint, status: res.status };
        }
        catch (e) {
            return { ok: false, endpoint, error: e?.message || 'Storage unreachable' };
        }
    }
    async testLdap(body) {
        if (!this.ldap.enabled)
            return { ok: false, error: 'LDAP désactivé (LDAP_ENABLED=false)' };
        const result = await this.ldap.authenticate(body.username, body.password);
        if (!result)
            return { ok: false, error: 'Échec authentification LDAP' };
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
};
exports.AdminSettingsController = AdminSettingsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminSettingsController.prototype, "getSettings", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminSettingsController.prototype, "updateSettings", null);
__decorate([
    (0, common_1.Get)('overview'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminSettingsController.prototype, "overview", null);
__decorate([
    (0, common_1.Post)('test-storage'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminSettingsController.prototype, "testStorage", null);
__decorate([
    (0, common_1.Post)('test-ldap'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AdminSettingsController.prototype, "testLdap", null);
exports.AdminSettingsController = AdminSettingsController = __decorate([
    (0, common_1.Controller)('admin/settings'),
    (0, roles_decorator_1.Roles)('admin'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        ldap_service_1.LdapService])
], AdminSettingsController);
//# sourceMappingURL=admin-settings.controller.js.map