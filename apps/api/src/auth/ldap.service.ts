import { Injectable, Logger } from '@nestjs/common';
import { loadRuntimeSettings } from '../config/runtime-settings';
import type { LdapRoleMapping, LdapGroupMapping } from '../config/runtime-settings';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Lightweight LDAP/AD authentication service.
 * Uses the `ldapjs` package (optional peer dependency) only when LDAP_ENABLED=true.
 *
 * Environment variables:
 *   LDAP_ENABLED        – "true" to activate
 *   LDAP_URL            – e.g. ldap://dc.domain.local:389
 *   LDAP_BIND_DN        – service account DN
 *   LDAP_BIND_PASSWORD  – service account password
 *   LDAP_SEARCH_BASE    – base DN to search users
 *   LDAP_SEARCH_FILTER  – filter template, {{username}} replaced at runtime
 *   LDAP_ADMIN_GROUP    – DN of the AD group → admin role
 *   LDAP_EDITOR_GROUP   – DN of the AD group → editor role (default if matched)
 */

export type LdapUser = {
  dn: string;
  email: string;
  displayName: string;
  memberOf: string[];
};

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  get enabled(): boolean {
    if (process.env.LDAP_ENABLED === 'true') return true;
    try {
      const raw = readFileSync(join(process.cwd(), 'config', 'admin-settings.json'), 'utf8');
      const json = JSON.parse(raw);
      const authMode = json?.auth?.mode;
      if (authMode === 'ldap' || authMode === 'hybrid') return true;
      return Boolean(json?.ldap?.enabled);
    } catch {
      return false;
    }
  }

  /** Authenticate a user against AD and return their profile, or null on failure. */
  async authenticate(username: string, password: string): Promise<LdapUser | null> {
    if (!this.enabled) return null;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let ldap: any;
    try {
      ldap = require('ldapjs');
    } catch {
      this.logger.error('ldapjs not installed – run: npm i ldapjs');
      return null;
    }

    const cfg = (await loadRuntimeSettings()).ldap;
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

    // Step 1: bind with service account and search for the user
    const serviceClient = ldap.createClient({
      url,
      tlsOptions: { rejectUnauthorized: !insecureTls },
    });

    const entry = await new Promise<LdapUser | null>((resolve) => {
      serviceClient.bind(bindDn, bindPw, (err: any) => {
        if (err) {
          this.logger.error(`LDAP service bind failed: ${err.message}`);
          serviceClient.unbind(() => {});
          return resolve(null);
        }

        const filter = filterTpl.replace(/\{\{username\}\}/g, username);
        serviceClient.search(searchBase, {
          scope: 'sub',
          filter,
          attributes: ['dn', 'mail', 'displayName', 'memberOf', 'sAMAccountName'],
        }, (searchErr: any, res: any) => {
          if (searchErr) {
            this.logger.error(`LDAP search error: ${searchErr.message}`);
            serviceClient.unbind(() => {});
            return resolve(null);
          }

          let found: LdapUser | null = null;

          res.on('searchEntry', (e: any) => {
            const attrs = e.ppiObject || e.object || {};

            found = {
              dn: typeof e.dn === 'string' ? e.dn : e.dn?.toString?.() || '',
              email: (attrs.mail as string) || `${username}@ldap.local`,
              displayName: (attrs.displayName as string) || username,
              memberOf: Array.isArray(attrs.memberOf) ? attrs.memberOf : attrs.memberOf ? [attrs.memberOf] : [],
            };
          });

          res.on('error', (e: any) => {
            this.logger.error(`LDAP search stream error: ${e.message}`);
            resolve(null);
          });

          res.on('end', () => {
            serviceClient.unbind(() => {});
            resolve(found);
          });
        });
      });
    });

    if (!entry) return null;

    // Step 2: verify user's own password by binding with their DN
    const userClient = ldap.createClient({
      url,
      tlsOptions: { rejectUnauthorized: !insecureTls },
    });

    const authenticated = await new Promise<boolean>((resolve) => {
      userClient.bind(entry.dn, password, (err: any) => {
        userClient.unbind(() => {});
        if (err) {
          this.logger.warn(`LDAP user bind failed for ${username}: ${err.message}`);
          return resolve(false);
        }
        resolve(true);
      });
    });

    return authenticated ? entry : null;
  }

  /**
   * Map AD group membership to LMPdf role.
   * Priority: roleMappings[] (first match wins, ordered admin > editor > viewer)
   * then legacy adminGroup / editorGroup fields for backward compatibility.
   * Default fallback: editor.
   */
  async resolveRole(memberOf: string[]): Promise<'admin' | 'editor' | 'viewer'> {
    const memberOfLower = memberOf.map((g) => g.toLowerCase());
    const cfg = (await loadRuntimeSettings()).ldap;

    // 1. New roleMappings[] – first match by priority (admin > editor > viewer)
    const roleMappings: LdapRoleMapping[] = cfg.roleMappings || [];
    if (roleMappings.length > 0) {
      const priority: Record<string, number> = { admin: 0, editor: 1, viewer: 2 };
      const sorted = [...roleMappings].sort((a, b) => (priority[a.role] ?? 9) - (priority[b.role] ?? 9));
      for (const mapping of sorted) {
        if (memberOfLower.includes(mapping.groupDn.toLowerCase())) {
          return mapping.role;
        }
      }
    }

    // 2. Legacy adminGroup / editorGroup (backward compat)
    const adminGroup = cfg.adminGroup || process.env.LDAP_ADMIN_GROUP;
    const editorGroup = cfg.editorGroup || process.env.LDAP_EDITOR_GROUP;

    if (adminGroup && memberOfLower.includes(adminGroup.toLowerCase())) return 'admin';
    if (editorGroup && memberOfLower.includes(editorGroup.toLowerCase())) return 'editor';

    return 'editor';
  }

  /**
   * Resolve which internal LMPdf groups a user should belong to
   * based on their AD memberOf and the configured groupMappings[].
   * Returns a list of internal group names the user should be synced into.
   */
  async resolveGroupMappings(memberOf: string[]): Promise<string[]> {
    const memberOfLower = memberOf.map((g) => g.toLowerCase());
    const cfg = (await loadRuntimeSettings()).ldap;
    const groupMappings: LdapGroupMapping[] = cfg.groupMappings || [];
    if (groupMappings.length === 0) return [];

    const matched: string[] = [];
    for (const mapping of groupMappings) {
      if (memberOfLower.includes(mapping.groupDn.toLowerCase())) {
        matched.push(mapping.internalGroupName);
      }
    }
    return matched;
  }

  /** Check if group membership sync is enabled */
  async isSyncGroupMembershipEnabled(): Promise<boolean> {
    const cfg = (await loadRuntimeSettings()).ldap;
    return cfg.syncGroupMembership !== false; // default true
  }
}
