"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var LdapService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LdapService = void 0;
const common_1 = require("@nestjs/common");
const runtime_settings_1 = require("../config/runtime-settings");
const fs_1 = require("fs");
const path_1 = require("path");
let LdapService = LdapService_1 = class LdapService {
    constructor() {
        this.logger = new common_1.Logger(LdapService_1.name);
    }
    get enabled() {
        if (process.env.LDAP_ENABLED === 'true')
            return true;
        try {
            const raw = (0, fs_1.readFileSync)((0, path_1.join)(process.cwd(), 'config', 'admin-settings.json'), 'utf8');
            const json = JSON.parse(raw);
            const authMode = json?.auth?.mode;
            if (authMode === 'ldap' || authMode === 'hybrid')
                return true;
            return Boolean(json?.ldap?.enabled);
        }
        catch {
            return false;
        }
    }
    async authenticate(username, password) {
        if (!this.enabled)
            return null;
        let ldap;
        try {
            ldap = require('ldapjs');
        }
        catch {
            this.logger.error('ldapjs not installed – run: npm i ldapjs');
            return null;
        }
        const cfg = (await (0, runtime_settings_1.loadRuntimeSettings)()).ldap;
        const url = cfg.url || process.env.LDAP_URL || '';
        const bindDn = cfg.bindDn || process.env.LDAP_BIND_DN || '';
        const bindPw = cfg.bindPassword || process.env.LDAP_BIND_PASSWORD || '';
        const searchBase = cfg.searchBase || process.env.LDAP_SEARCH_BASE || '';
        const filterTpl = cfg.searchFilter || process.env.LDAP_SEARCH_FILTER || '(sAMAccountName={{username}})';
        if (!url || !bindDn || !bindPw || !searchBase) {
            this.logger.warn('LDAP config incomplete (url/bind/search base)');
            return null;
        }
        const insecureTls = (process.env.LDAP_INSECURE_TLS || 'false') === 'true';
        const serviceClient = ldap.createClient({
            url,
            tlsOptions: { rejectUnauthorized: !insecureTls },
        });
        const entry = await new Promise((resolve) => {
            serviceClient.bind(bindDn, bindPw, (err) => {
                if (err) {
                    this.logger.error(`LDAP service bind failed: ${err.message}`);
                    serviceClient.unbind(() => { });
                    return resolve(null);
                }
                const filter = filterTpl.replace(/\{\{username\}\}/g, username);
                serviceClient.search(searchBase, {
                    scope: 'sub',
                    filter,
                    attributes: ['dn', 'mail', 'displayName', 'memberOf', 'sAMAccountName'],
                }, (searchErr, res) => {
                    if (searchErr) {
                        this.logger.error(`LDAP search error: ${searchErr.message}`);
                        serviceClient.unbind(() => { });
                        return resolve(null);
                    }
                    let found = null;
                    res.on('searchEntry', (e) => {
                        const attrs = e.ppiObject || e.object || {};
                        found = {
                            dn: typeof e.dn === 'string' ? e.dn : e.dn?.toString?.() || '',
                            email: attrs.mail || `${username}@ldap.local`,
                            displayName: attrs.displayName || username,
                            memberOf: Array.isArray(attrs.memberOf) ? attrs.memberOf : attrs.memberOf ? [attrs.memberOf] : [],
                        };
                    });
                    res.on('error', (e) => {
                        this.logger.error(`LDAP search stream error: ${e.message}`);
                        resolve(null);
                    });
                    res.on('end', () => {
                        serviceClient.unbind(() => { });
                        resolve(found);
                    });
                });
            });
        });
        if (!entry)
            return null;
        const userClient = ldap.createClient({
            url,
            tlsOptions: { rejectUnauthorized: !insecureTls },
        });
        const authenticated = await new Promise((resolve) => {
            userClient.bind(entry.dn, password, (err) => {
                userClient.unbind(() => { });
                if (err) {
                    this.logger.warn(`LDAP user bind failed for ${username}: ${err.message}`);
                    return resolve(false);
                }
                resolve(true);
            });
        });
        return authenticated ? entry : null;
    }
    async resolveRole(memberOf) {
        const memberOfLower = memberOf.map((g) => g.toLowerCase());
        const cfg = (await (0, runtime_settings_1.loadRuntimeSettings)()).ldap;
        const roleMappings = cfg.roleMappings || [];
        if (roleMappings.length > 0) {
            const priority = { admin: 0, editor: 1, viewer: 2 };
            const sorted = [...roleMappings].sort((a, b) => (priority[a.role] ?? 9) - (priority[b.role] ?? 9));
            for (const mapping of sorted) {
                if (memberOfLower.includes(mapping.groupDn.toLowerCase())) {
                    return mapping.role;
                }
            }
        }
        const adminGroup = cfg.adminGroup || process.env.LDAP_ADMIN_GROUP;
        const editorGroup = cfg.editorGroup || process.env.LDAP_EDITOR_GROUP;
        if (adminGroup && memberOfLower.includes(adminGroup.toLowerCase()))
            return 'admin';
        if (editorGroup && memberOfLower.includes(editorGroup.toLowerCase()))
            return 'editor';
        return 'editor';
    }
    async resolveGroupMappings(memberOf) {
        const memberOfLower = memberOf.map((g) => g.toLowerCase());
        const cfg = (await (0, runtime_settings_1.loadRuntimeSettings)()).ldap;
        const groupMappings = cfg.groupMappings || [];
        if (groupMappings.length === 0)
            return [];
        const matched = [];
        for (const mapping of groupMappings) {
            if (memberOfLower.includes(mapping.groupDn.toLowerCase())) {
                matched.push(mapping.internalGroupName);
            }
        }
        return matched;
    }
    async isSyncGroupMembershipEnabled() {
        const cfg = (await (0, runtime_settings_1.loadRuntimeSettings)()).ldap;
        return cfg.syncGroupMembership !== false;
    }
};
exports.LdapService = LdapService;
exports.LdapService = LdapService = LdapService_1 = __decorate([
    (0, common_1.Injectable)()
], LdapService);
//# sourceMappingURL=ldap.service.js.map