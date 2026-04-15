import { useEffect, useState, lazy, Suspense } from 'react';
import { getAdminOverview, getAdminSettings, saveAdminSettings, testLdapConnection, testStorageConnection, validateExportConfig, previewExportResolve, getExportLogs, getExportStats, purgeExportLogs } from '../api';
import type { ExportLogEntry, ExportStatsResponse } from '../api';
import { useTranslation } from '../i18n';

const AdminUserMfaPanel = lazy(() => import('./AdminUserMfaPanel'));

type Props = { onClose: () => void };

type RoleMappingRow = { groupDn: string; role: 'admin' | 'editor' | 'viewer' };
type GroupMappingRow = { groupDn: string; internalGroupName: string };

type ExportDestinationRow = {
  name: string;
  enabled: boolean;
  rootPath: string;
  pathTemplate: string;
  fileNameTemplate: string;
  conflictStrategy: 'overwrite' | 'rename' | 'skip';
};

type ExportRuleRow = {
  label: string;
  enabled: boolean;
  destinationName: string;
  templateNameContains?: string;
  templateId?: string;
  authSource?: 'local' | 'ldap' | '';
  role?: 'admin' | 'editor' | 'viewer' | '';
  groupName?: string;
};

const ACTION_KEYS = [
  'uploadDocument',
  'createTemplate',
  'manageTemplate',
  'editStructure',
  'createPage',
  'exportPdf',
  'printDocument',
] as const;

export default function AdminSettingsPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [settings, setSettings] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [ldapUser, setLdapUser] = useState('');
  const [ldapPass, setLdapPass] = useState('');
  const [exportPreviewUser, setExportPreviewUser] = useState('');
  const [exportPreviewTemplate, setExportPreviewTemplate] = useState('');
  const [exportPreviewResult, setExportPreviewResult] = useState<any>(null);
  const [exportLogs, setExportLogs] = useState<ExportLogEntry[]>([]);
  const [exportLogsTotal, setExportLogsTotal] = useState(0);
  const [exportLogsLoading, setExportLogsLoading] = useState(false);
  const [exportLogsLoaded, setExportLogsLoaded] = useState(false);
  const [exportLogsFilter, setExportLogsFilter] = useState<string>('');
  const [exportLogsOffset, setExportLogsOffset] = useState(0);
  const [exportLogsUserEmail, setExportLogsUserEmail] = useState('');
  const [exportLogsFrom, setExportLogsFrom] = useState('');
  const [exportLogsTo, setExportLogsTo] = useState('');
  const [exportStats, setExportStats] = useState<ExportStatsResponse | null>(null);
  const [exportStatsLoading, setExportStatsLoading] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [purgeDays, setPurgeDays] = useState(90);
  const [purgeStatus, setPurgeStatus] = useState('');
  const [showMfaAdmin, setShowMfaAdmin] = useState(false);

  useEffect(() => {
    Promise.all([getAdminSettings(), getAdminOverview()])
      .then(([s, o]) => {
        const permissions = s.permissions || { admin: {}, editor: {}, viewer: {} };
        const exportCfg = s.export || { enabled: false, allowedRoots: [], destinations: [], rules: [] };
        setSettings({ ...s, permissions, export: exportCfg });
        setOverview(o);
        setLoading(false);
      })
      .catch(() => {
        setStatus(t('admin.loadError'));
        setLoading(false);
      });
  }, [t]);

  if (loading) return <div className="modal-backdrop"><div className="modal">{t('common.loading')}</div></div>;
  if (!settings) return <div className="modal-backdrop"><div className="modal">{t('common.error')}. <button onClick={onClose}>{t('common.close')}</button></div></div>;

  const PAGE_SIZE = 30;

  const loadExportLogs = async (statusFilter?: string, append = false) => {
    setExportLogsLoading(true);
    const offset = append ? exportLogs.length : 0;
    try {
      const r = await getExportLogs({
        limit: PAGE_SIZE,
        offset,
        status: statusFilter || undefined,
        userEmail: exportLogsUserEmail.trim() || undefined,
        from: exportLogsFrom || undefined,
        to: exportLogsTo || undefined,
      });
      setExportLogs(append ? [...exportLogs, ...r.logs] : r.logs);
      setExportLogsTotal(r.total);
      setExportLogsOffset(offset + r.logs.length);
      setExportLogsLoaded(true);
    } catch {
      if (!append) {
        setExportLogs([]);
        setExportLogsTotal(0);
      }
    } finally {
      setExportLogsLoading(false);
    }
  };

  const loadExportStats = async () => {
    setExportStatsLoading(true);
    try {
      const s = await getExportStats();
      setExportStats(s);
    } catch {
      setExportStats(null);
    } finally {
      setExportStatsLoading(false);
    }
  };

  const handlePurge = async (mode: 'days' | 'all') => {
    setPurgeStatus('');
    try {
      const r = await purgeExportLogs(
        mode === 'all' ? { all: true } : { olderThanDays: purgeDays },
      );
      setPurgeStatus(t('admin.exportPurgeSuccess', { count: String(r.purged) }));
      setPurgeConfirm(false);
      // Refresh logs + stats
      loadExportLogs(exportLogsFilter);
      loadExportStats();
    } catch (e: any) {
      setPurgeStatus(e.message || t('common.error'));
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const update = (path: string, value: any) => {
    const [root, key] = path.split('.');
    setSettings((prev: any) => ({ ...prev, [root]: { ...prev[root], [key]: value } }));
  };

  const togglePermission = (role: 'editor' | 'viewer', action: string, enabled: boolean) => {
    setSettings((prev: any) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [role]: {
          ...(prev.permissions?.[role] || {}),
          [action]: enabled,
        },
      },
    }));
  };

  return (
    <div className="modal-backdrop">
      <div className="modal admin-modal">
        <div className="admin-header">
          <h3>{t('admin.title')}</h3>
          <button className="admin-close-btn" onClick={onClose} title={t('common.close')}>✕</button>
        </div>

        {/* Overview Stats - Always visible */}
        {overview && (
          <div className="admin-overview">
            <div className="admin-stat"><span className="stat-value">{overview.counts.users}</span><span className="stat-label">{t('admin.users')}</span></div>
            <div className="admin-stat"><span className="stat-value">{overview.counts.groups}</span><span className="stat-label">{t('admin.groups')}</span></div>
            <div className="admin-stat"><span className="stat-value">{overview.counts.documents}</span><span className="stat-label">{t('admin.documents')}</span></div>
            <div className="admin-stat"><span className="stat-value">{overview.counts.templates}</span><span className="stat-label">{t('admin.templates')}</span></div>
            <div className="admin-stat stat-wide"><span className="stat-value">{t(`admin.authModes.${overview.authMode || settings.auth.mode}`)}</span><span className="stat-label">{t('admin.authMode')}</span></div>
          </div>
        )}

        {/* Accordion Sections */}
        <div className="admin-sections">
          {/* Auth & Security */}
          <details open className="admin-section">
            <summary className="admin-section-summary">🔐 {t('admin.authTitle')}</summary>
            <div className="admin-section-content">
              <div className="admin-grid">
                <label>
                  {t('admin.authMode')}
                  <select value={settings.auth.mode || 'local'} onChange={(e) => update('auth.mode', e.target.value)}>
                    <option value="local">{t('admin.authModes.local')}</option>
                    <option value="ldap">{t('admin.authModes.ldap')}</option>
                    <option value="hybrid">{t('admin.authModes.hybrid')}</option>
                  </select>
                </label>
              </div>
              <label className="checkbox-toggle"><input type="checkbox" checked={Boolean(settings.auth.allowLocalAdminFallback)} onChange={(e) => update('auth.allowLocalAdminFallback', e.target.checked)} /> {t('admin.authAllowLocalAdminFallback')}</label>
              <label className="checkbox-toggle"><input type="checkbox" checked={Boolean(settings.auth.autoProvisionUsers)} onChange={(e) => update('auth.autoProvisionUsers', e.target.checked)} /> {t('admin.authAutoProvisionUsers')}</label>

              {/* MFA Subsection */}
              <div className="admin-subsection">
                <h5>🔐 {t('admin.mfaTitle')}</h5>
                <label>
                  {t('admin.mfaPolicy')}
                  <select value={settings.mfa?.policy || 'optional'} onChange={(e) => update('mfa.policy', e.target.value)}>
                    <option value="disabled">{t('admin.mfaPolicies.disabled')}</option>
                    <option value="optional">{t('admin.mfaPolicies.optional')}</option>
                    <option value="required">{t('admin.mfaPolicies.required')}</option>
                  </select>
                </label>
                <p className="admin-hint">{t('admin.mfaPolicyHelp')}</p>
                <button onClick={() => setShowMfaAdmin(true)} className="admin-btn-secondary">{t('adminMfa.openButton')}</button>
              </div>

              {showMfaAdmin && (
                <Suspense fallback={<div className="modal-backdrop"><div className="modal">{t('common.loading')}</div></div>}>
                  <AdminUserMfaPanel onClose={() => setShowMfaAdmin(false)} />
                </Suspense>
              )}
            </div>
          </details>

          {/* Organization */}
          <details className="admin-section">
            <summary className="admin-section-summary">🏢 {t('admin.organizationTitle')}</summary>
            <div className="admin-section-content">
              <div className="admin-grid">
                <label>
                  {t('admin.organizationMode')}
                  <select value={settings.organization.mode || 'team'} onChange={(e) => update('organization.mode', e.target.value)}>
                    <option value="personal">{t('admin.organizationModes.personal')}</option>
                    <option value="team">{t('admin.organizationModes.team')}</option>
                    <option value="directory-managed">{t('admin.organizationModes.directoryManaged')}</option>
                  </select>
                </label>
                <label>
                  {t('admin.organizationDefaultOwnership')}
                  <select value={settings.organization.defaultOwnership || 'user'} onChange={(e) => update('organization.defaultOwnership', e.target.value)}>
                    <option value="user">{t('admin.organizationOwnership.user')}</option>
                    <option value="group">{t('admin.organizationOwnership.group')}</option>
                  </select>
                </label>
              </div>
              <label className="checkbox-toggle"><input type="checkbox" checked={Boolean(settings.organization.allowUserGroups)} onChange={(e) => update('organization.allowUserGroups', e.target.checked)} /> {t('admin.organizationAllowUserGroups')}</label>
              <label className="checkbox-toggle"><input type="checkbox" checked={Boolean(settings.organization.allowSharedFolders)} onChange={(e) => update('organization.allowSharedFolders', e.target.checked)} /> {t('admin.organizationAllowSharedFolders')}</label>
            </div>
          </details>

          {/* Rights / Permissions */}
          <details className="admin-section">
            <summary className="admin-section-summary">🔑 {t('admin.rightsTitle')}</summary>
            <div className="admin-section-content">
              <div style={{ overflowX: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{t('admin.actionHeader')}</th>
                      <th className="center">{t('admin.editorHeader')}</th>
                      <th className="center">{t('admin.viewerHeader')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ACTION_KEYS.map((key) => (
                      <tr key={key}>
                        <td>{t(`admin.actionLabels.${key}`)}</td>
                        <td className="center"><input type="checkbox" checked={Boolean(settings.permissions?.editor?.[key])} onChange={(e) => togglePermission('editor', key, e.target.checked)} /></td>
                        <td className="center"><input type="checkbox" checked={Boolean(settings.permissions?.viewer?.[key])} onChange={(e) => togglePermission('viewer', key, e.target.checked)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          {/* Storage */}
          <details className="admin-section">
            <summary className="admin-section-summary">💾 {t('admin.storageTitle')}</summary>
            <div className="admin-section-content">
              <div className="admin-grid">
                <label>{t('admin.storageEndpoint')}<input value={settings.storage.endpoint || ''} onChange={(e) => update('storage.endpoint', e.target.value)} placeholder="https://s3.example.com" /></label>
                <label>{t('admin.storageBucket')}<input value={settings.storage.bucket || ''} onChange={(e) => update('storage.bucket', e.target.value)} /></label>
                <label>{t('admin.storageRegion')}<input value={settings.storage.region || ''} onChange={(e) => update('storage.region', e.target.value)} /></label>
              </div>
              <div className="admin-actions">
                <button onClick={async () => {
                  setStatus(t('admin.testingStorage'));
                  const r = await testStorageConnection().catch((e) => ({ ok: false, error: e.message }));
                  setStatus(r.ok ? t('admin.storageOk', { status: r.status }) : t('admin.storageKo', { error: r.error }));
                }}>{t('admin.testStorage')}</button>
              </div>
            </div>
          </details>

          {/* LDAP */}
          <details className="admin-section">
            <summary className="admin-section-summary">🔌 {t('admin.ldapTitle')}</summary>
            <div className="admin-section-content">
              <label className="checkbox-toggle"><input type="checkbox" checked={Boolean(settings.ldap.enabled)} onChange={(e) => update('ldap.enabled', e.target.checked)} /> {t('admin.ldapEnable')}</label>
              
              <div className="admin-grid">
                <label>{t('admin.ldapUrl')}<input value={settings.ldap.url || ''} onChange={(e) => update('ldap.url', e.target.value)} placeholder="ldap://server:389" /></label>
                <label>{t('admin.ldapBindDn')}<input value={settings.ldap.bindDn || ''} onChange={(e) => update('ldap.bindDn', e.target.value)} /></label>
              </div>
              <div className="admin-grid">
                <label>{t('admin.ldapBindPassword')}<input type="password" value={settings.ldap.bindPassword || ''} onChange={(e) => update('ldap.bindPassword', e.target.value)} /></label>
                <label>{t('admin.ldapSearchBase')}<input value={settings.ldap.searchBase || ''} onChange={(e) => update('ldap.searchBase', e.target.value)} /></label>
              </div>
              <div className="admin-grid">
                <label>{t('admin.ldapSearchFilter')}<input value={settings.ldap.searchFilter || ''} onChange={(e) => update('ldap.searchFilter', e.target.value)} placeholder="(uid={username})" /></label>
                <label>{t('admin.ldapAdminGroup')}<input value={settings.ldap.adminGroup || ''} onChange={(e) => update('ldap.adminGroup', e.target.value)} /></label>
              </div>
              <label>{t('admin.ldapEditorGroup')}<input value={settings.ldap.editorGroup || ''} onChange={(e) => update('ldap.editorGroup', e.target.value)} /></label>

              {/* LDAP Test */}
              <div className="admin-subsection">
                <h5>🧪 {t('admin.ldapTestUser') || 'Test LDAP'}</h5>
                <div className="admin-grid">
                  <label><input value={ldapUser} onChange={(e) => setLdapUser(e.target.value)} placeholder={t('admin.ldapTestUserPlaceholder')} /></label>
                  <label><input type="password" value={ldapPass} onChange={(e) => setLdapPass(e.target.value)} placeholder="••••••" /></label>
                </div>
                <div className="admin-actions">
                  <button onClick={async () => {
                    setStatus(t('admin.testingLdap'));
                    const r = await testLdapConnection(ldapUser, ldapPass).catch((e) => ({ ok: false, error: e.message }));
                    setStatus(r.ok ? t('admin.ldapOk', { name: r.user?.displayName || 'user' }) : t('admin.ldapKo', { error: r.error }));
                  }}>{t('admin.testLdap')}</button>
                </div>
              </div>

              {/* LDAP Mappings */}
              <div className="admin-subsection">
                <h5>{t('admin.ldapMappingsTitle')}</h5>
                <label className="checkbox-toggle">
                  <input type="checkbox" checked={settings.ldap.syncGroupMembership !== false} onChange={(e) => update('ldap.syncGroupMembership', e.target.checked)} />
                  {t('admin.ldapSyncGroupMembership')}
                </label>

                <h6>{t('admin.ldapRoleMappingsTitle')}</h6>
                <p className="admin-hint">{t('admin.ldapRoleMappingsHelp')}</p>
                {(settings.ldap.roleMappings || []).map((rm: RoleMappingRow, idx: number) => (
                  <div key={idx} className="admin-row">
                    <input style={{ flex: 2 }} placeholder={t('admin.ldapMappingGroupDnPlaceholder')} value={rm.groupDn} onChange={(e) => {
                      const arr = [...(settings.ldap.roleMappings || [])];
                      arr[idx] = { ...arr[idx], groupDn: e.target.value };
                      update('ldap.roleMappings', arr);
                    }} />
                    <select style={{ flex: 1 }} value={rm.role} onChange={(e) => {
                      const arr = [...(settings.ldap.roleMappings || [])];
                      arr[idx] = { ...arr[idx], role: e.target.value as 'admin' | 'editor' | 'viewer' };
                      update('ldap.roleMappings', arr);
                    }}>
                      <option value="admin">Admin</option>
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button className="btn-icon-sm" onClick={() => {
                      const arr = [...(settings.ldap.roleMappings || [])];
                      arr.splice(idx, 1);
                      update('ldap.roleMappings', arr);
                    }}>✕</button>
                  </div>
                ))}
                <button className="admin-btn-add" onClick={() => {
                  const arr = [...(settings.ldap.roleMappings || []), { groupDn: '', role: 'editor' }];
                  update('ldap.roleMappings', arr);
                }}>+ {t('admin.ldapAddRoleMapping')}</button>

                <h6>{t('admin.ldapGroupMappingsTitle')}</h6>
                <p className="admin-hint">{t('admin.ldapGroupMappingsHelp')}</p>
                {(settings.ldap.groupMappings || []).map((gm: GroupMappingRow, idx: number) => (
                  <div key={idx} className="admin-row">
                    <input style={{ flex: 2 }} placeholder={t('admin.ldapMappingGroupDnPlaceholder')} value={gm.groupDn} onChange={(e) => {
                      const arr = [...(settings.ldap.groupMappings || [])];
                      arr[idx] = { ...arr[idx], groupDn: e.target.value };
                      update('ldap.groupMappings', arr);
                    }} />
                    <input style={{ flex: 1 }} placeholder={t('admin.ldapMappingInternalGroupPlaceholder')} value={gm.internalGroupName} onChange={(e) => {
                      const arr = [...(settings.ldap.groupMappings || [])];
                      arr[idx] = { ...arr[idx], internalGroupName: e.target.value };
                      update('ldap.groupMappings', arr);
                    }} />
                    <button className="btn-icon-sm" onClick={() => {
                      const arr = [...(settings.ldap.groupMappings || [])];
                      arr.splice(idx, 1);
                      update('ldap.groupMappings', arr);
                    }}>✕</button>
                  </div>
                ))}
                <button className="admin-btn-add" onClick={() => {
                  const arr = [...(settings.ldap.groupMappings || []), { groupDn: '', internalGroupName: '' }];
                  update('ldap.groupMappings', arr);
                }}>+ {t('admin.ldapAddGroupMapping')}</button>
              </div>
            </div>
          </details>

          {/* Export */}
          <details className="admin-section">
            <summary className="admin-section-summary">📤 {t('admin.exportTitle')}</summary>
            <div className="admin-section-content">
              <label className="checkbox-toggle">
                <input type="checkbox" checked={Boolean(settings.export?.enabled)} onChange={(e) => setSettings((prev: any) => ({ ...prev, export: { ...prev.export, enabled: e.target.checked } }))} />
                {t('admin.exportEnabled')}
              </label>

              {settings.export?.enabled && (
                <>
                  {/* Allowed Roots */}
                  <div className="admin-subsection">
                    <h5>{t('admin.exportAllowedRoots')}</h5>
                    <p className="admin-hint">{t('admin.exportAllowedRootsHelp')}</p>
                    {(settings.export.allowedRoots || []).map((root: string, idx: number) => (
                      <div key={idx} className="admin-row">
                        <input style={{ flex: 1 }} placeholder={t('admin.exportRootPlaceholder')} value={root} onChange={(e) => {
                          const arr = [...(settings.export.allowedRoots || [])];
                          arr[idx] = e.target.value;
                          setSettings((prev: any) => ({ ...prev, export: { ...prev.export, allowedRoots: arr } }));
                        }} />
                        <button className="btn-icon-sm" onClick={() => {
                          const arr = [...(settings.export.allowedRoots || [])];
                          arr.splice(idx, 1);
                          setSettings((prev: any) => ({ ...prev, export: { ...prev.export, allowedRoots: arr } }));
                        }}>✕</button>
                      </div>
                    ))}
                    <button className="admin-btn-add" onClick={() => {
                      const arr = [...(settings.export.allowedRoots || []), ''];
                      setSettings((prev: any) => ({ ...prev, export: { ...prev.export, allowedRoots: arr } }));
                    }}>+ {t('admin.exportAddRoot')}</button>
                  </div>

                  {/* Destinations */}
                  <div className="admin-subsection">
                    <h5>{t('admin.exportDestinations')}</h5>
                    <p className="admin-hint">{t('admin.exportPlaceholdersHelp')}</p>
                    {(settings.export.destinations || []).map((dest: ExportDestinationRow, idx: number) => (
                      <div key={idx} className="admin-card">
                        <div className="admin-row admin-card-header">
                          <label style={{ flex: 1 }}>{t('admin.exportDestName')}<input placeholder={t('admin.exportDestNamePlaceholder')} value={dest.name} onChange={(e) => {
                            const arr = [...(settings.export.destinations || [])];
                            arr[idx] = { ...arr[idx], name: e.target.value };
                            setSettings((prev: any) => ({ ...prev, export: { ...prev.export, destinations: arr } }));
                          }} /></label>
                          <label className="checkbox-toggle checkbox-compact">
                            <input type="checkbox" checked={Boolean(dest.enabled)} onChange={(e) => {
                              const arr = [...(settings.export.destinations || [])];
                              arr[idx] = { ...arr[idx], enabled: e.target.checked };
                              setSettings((prev: any) => ({ ...prev, export: { ...prev.export, destinations: arr } }));
                            }} /> {t('admin.exportDestEnabled')}
                          </label>
                          <button className="btn-icon-sm" onClick={() => {
                            const arr = [...(settings.export.destinations || [])];
                            arr.splice(idx, 1);
                            setSettings((prev: any) => ({ ...prev, export: { ...prev.export, destinations: arr } }));
                          }}>✕</button>
                        </div>
                        <div className="admin-grid">
                          <label>{t('admin.exportDestRootPath')}
                            <select value={dest.rootPath} onChange={(e) => {
                              const arr = [...(settings.export.destinations || [])];
                              arr[idx] = { ...arr[idx], rootPath: e.target.value };
                              setSettings((prev: any) => ({ ...prev, export: { ...prev.export, destinations: arr } }));
                            }}>
                              <option value="">—</option>
                              {(settings.export.allowedRoots || []).map((r: string) => (<option key={r} value={r}>{r}</option>))}
                            </select>
                          </label>
                          <label>{t('admin.exportDestConflictStrategy')}
                            <select value={dest.conflictStrategy || 'rename'} onChange={(e) => {
                              const arr = [...(settings.export.destinations || [])];
                              arr[idx] = { ...arr[idx], conflictStrategy: e.target.value as any };
                              setSettings((prev: any) => ({ ...prev, export: { ...prev.export, destinations: arr } }));
                            }}>
                              <option value="overwrite">{t('admin.exportConflictOverwrite')}</option>
                              <option value="rename">{t('admin.exportConflictRename')}</option>
                              <option value="skip">{t('admin.exportConflictSkip')}</option>
                            </select>
                          </label>
                        </div>
                        <label>{t('admin.exportDestPathTemplate')}<input placeholder={t('admin.exportDestPathTemplatePlaceholder')} value={dest.pathTemplate} onChange={(e) => {
                          const arr = [...(settings.export.destinations || [])];
                          arr[idx] = { ...arr[idx], pathTemplate: e.target.value };
                          setSettings((prev: any) => ({ ...prev, export: { ...prev.export, destinations: arr } }));
                        }} /></label>
                        <label>{t('admin.exportDestFileNameTemplate')}<input placeholder={t('admin.exportDestFileNameTemplatePlaceholder')} value={dest.fileNameTemplate} onChange={(e) => {
                          const arr = [...(settings.export.destinations || [])];
                          arr[idx] = { ...arr[idx], fileNameTemplate: e.target.value };
                          setSettings((prev: any) => ({ ...prev, export: { ...prev.export, destinations: arr } }));
                        }} /></label>
                      </div>
                    ))}
                    <button className="admin-btn-add" onClick={() => {
                      const arr = [...(settings.export.destinations || []), {
                        name: '', enabled: true, rootPath: (settings.export.allowedRoots || [])[0] || '',
                        pathTemplate: '{year}/{month}', fileNameTemplate: '{templateName}_{date}_{username}',
                        conflictStrategy: 'rename',
                      }];
                      setSettings((prev: any) => ({ ...prev, export: { ...prev.export, destinations: arr } }));
                    }}>+ {t('admin.exportAddDestination')}</button>
                  </div>

                  {/* Rules */}
                  <div className="admin-subsection">
                    <h5>{t('admin.exportRules')}</h5>
                    <p className="admin-hint">Première règle correspondante gagne. Règle sans condition = fallback.</p>
                    {(settings.export.rules || []).map((rule: ExportRuleRow, idx: number) => (
                      <div key={idx} className="admin-card">
                        <div className="admin-row admin-card-header">
                          <label style={{ flex: 1 }}>{t('admin.exportRuleLabel')}<input placeholder={t('admin.exportRuleLabelPlaceholder')} value={rule.label} onChange={(e) => {
                            const arr = [...(settings.export.rules || [])];
                            arr[idx] = { ...arr[idx], label: e.target.value };
                            setSettings((prev: any) => ({ ...prev, export: { ...prev.export, rules: arr } }));
                          }} /></label>
                          <label className="checkbox-toggle checkbox-compact">
                            <input type="checkbox" checked={Boolean(rule.enabled)} onChange={(e) => {
                              const arr = [...(settings.export.rules || [])];
                              arr[idx] = { ...arr[idx], enabled: e.target.checked };
                              setSettings((prev: any) => ({ ...prev, export: { ...prev.export, rules: arr } }));
                            }} /> {t('admin.exportRuleEnabled')}
                          </label>
                          <button className="btn-icon-sm" onClick={() => {
                            const arr = [...(settings.export.rules || [])];
                            arr.splice(idx, 1);
                            setSettings((prev: any) => ({ ...prev, export: { ...prev.export, rules: arr } }));
                          }}>✕</button>
                        </div>
                        <div className="admin-grid">
                          <label>{t('admin.exportRuleDestination')}
                            <select value={rule.destinationName} onChange={(e) => {
                              const arr = [...(settings.export.rules || [])];
                              arr[idx] = { ...arr[idx], destinationName: e.target.value };
                              setSettings((prev: any) => ({ ...prev, export: { ...prev.export, rules: arr } }));
                            }}>
                              <option value="">—</option>
                              {(settings.export.destinations || []).map((d: ExportDestinationRow) => (<option key={d.name} value={d.name}>{d.name}</option>))}
                            </select>
                          </label>
                          <label>{t('admin.exportRuleTemplateNameContains')}<input placeholder={t('admin.exportRuleTemplateNameContainsPlaceholder')} value={rule.templateNameContains || ''} onChange={(e) => {
                            const arr = [...(settings.export.rules || [])];
                            arr[idx] = { ...arr[idx], templateNameContains: e.target.value || undefined };
                            setSettings((prev: any) => ({ ...prev, export: { ...prev.export, rules: arr } }));
                          }} /></label>
                        </div>
                        <div className="admin-grid admin-grid-3">
                          <label>{t('admin.exportRuleAuthSource')}
                            <select value={rule.authSource || ''} onChange={(e) => {
                              const arr = [...(settings.export.rules || [])];
                              arr[idx] = { ...arr[idx], authSource: (e.target.value || undefined) as any };
                              setSettings((prev: any) => ({ ...prev, export: { ...prev.export, rules: arr } }));
                            }}>
                              <option value="">{t('admin.exportRuleAny')}</option>
                              <option value="local">Local</option>
                              <option value="ldap">LDAP</option>
                            </select>
                          </label>
                          <label>{t('admin.exportRuleRole')}
                            <select value={rule.role || ''} onChange={(e) => {
                              const arr = [...(settings.export.rules || [])];
                              arr[idx] = { ...arr[idx], role: (e.target.value || undefined) as any };
                              setSettings((prev: any) => ({ ...prev, export: { ...prev.export, rules: arr } }));
                            }}>
                              <option value="">{t('admin.exportRuleAny')}</option>
                              <option value="admin">Admin</option>
                              <option value="editor">Editor</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          </label>
                          <label>{t('admin.exportRuleGroupName')}<input placeholder={t('admin.exportRuleGroupNamePlaceholder')} value={rule.groupName || ''} onChange={(e) => {
                            const arr = [...(settings.export.rules || [])];
                            arr[idx] = { ...arr[idx], groupName: e.target.value || undefined };
                            setSettings((prev: any) => ({ ...prev, export: { ...prev.export, rules: arr } }));
                          }} /></label>
                        </div>
                      </div>
                    ))}
                    <button className="admin-btn-add" onClick={() => {
                      const arr = [...(settings.export.rules || []), {
                        label: '', enabled: true, destinationName: (settings.export.destinations || [])[0]?.name || '',
                      }];
                      setSettings((prev: any) => ({ ...prev, export: { ...prev.export, rules: arr } }));
                    }}>+ {t('admin.exportAddRule')}</button>
                  </div>

                  {/* Validation */}
                  <div className="admin-actions">
                    <button onClick={async () => {
                      setStatus('Validation…');
                      try {
                        await saveAdminSettings(settings);
                        const r = await validateExportConfig();
                        setStatus(r.valid ? t('admin.exportValidationOk') : t('admin.exportValidationErrors', { errors: r.errors.join(', ') }));
                      } catch (e: any) {
                        setStatus(e.message);
                      }
                    }}>{t('admin.exportValidate')}</button>
                  </div>

                  {/* Preview */}
                  <div className="admin-subsection">
                    <h5>{t('admin.exportPreviewTitle')}</h5>
                    <div className="admin-grid">
                      <label>{t('admin.exportPreviewUsername')}<input value={exportPreviewUser} onChange={(e) => setExportPreviewUser(e.target.value)} placeholder="jdupont" /></label>
                      <label>{t('admin.exportPreviewTemplateName')}<input value={exportPreviewTemplate} onChange={(e) => setExportPreviewTemplate(e.target.value)} placeholder="Facture standard" /></label>
                    </div>
                    <div className="admin-actions">
                      <button onClick={async () => {
                        try {
                          await saveAdminSettings(settings);
                          const r = await previewExportResolve({
                            username: exportPreviewUser || 'testuser',
                            templateName: exportPreviewTemplate || 'Template',
                          });
                          setExportPreviewResult(r);
                        } catch (e: any) {
                          setExportPreviewResult({ matched: false, errors: [e.message] });
                        }
                      }}>{t('admin.exportPreviewRun')}</button>
                    </div>
                    {exportPreviewResult && (
                      <div className="admin-result">
                        <strong>{t('admin.exportPreviewResult')}</strong><br />
                        {exportPreviewResult.matched ? (
                          <>
                            {t('admin.exportPreviewMatched', { rule: exportPreviewResult.ruleLabelMatched || '?', destination: exportPreviewResult.destinationName || '?' })}<br />
                            {exportPreviewResult.fullPath && <>{t('admin.exportPreviewPath', { path: exportPreviewResult.fullPath })}<br /></>}
                          </>
                        ) : (
                          <>{t('admin.exportPreviewNoMatch')}<br /></>
                        )}
                        {exportPreviewResult.errors?.length > 0 && (
                          <span className="error">{t('admin.exportPreviewErrors', { errors: exportPreviewResult.errors.join(', ') })}</span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </details>

          {/* Export Stats */}
          <details className="admin-section">
            <summary className="admin-section-summary">📊 {t('admin.exportStatsTitle')}</summary>
            <div className="admin-section-content">
              <div className="admin-actions" style={{ marginBottom: 12 }}>
                <button disabled={exportStatsLoading} onClick={loadExportStats}>
                  {exportStatsLoading ? t('common.loading') : exportStats ? t('admin.exportStatsRefresh') : t('admin.exportStatsLoad')}
                </button>
              </div>
              {exportStats && (
                <div className="admin-stats-grid">
                  <div className="admin-stat-box"><div className="stat-value">{exportStats.totalExports}</div><div className="stat-label">{t('admin.exportStatTotal')}</div></div>
                  <div className="admin-stat-box stat-success"><div className="stat-value">{exportStats.totalWritten}</div><div className="stat-label">{t('admin.exportStatWritten')}</div></div>
                  <div className="admin-stat-box stat-warn"><div className="stat-value">{exportStats.totalRenamed}</div><div className="stat-label">{t('admin.exportStatRenamed')}</div></div>
                  <div className="admin-stat-box stat-muted"><div className="stat-value">{exportStats.totalSkipped}</div><div className="stat-label">{t('admin.exportStatSkipped')}</div></div>
                  <div className="admin-stat-box stat-error"><div className="stat-value">{exportStats.totalErrors}</div><div className="stat-label">{t('admin.exportStatErrors')}</div></div>
                  <div className="admin-stat-box"><div className="stat-value">{exportStats.uniqueUsers}</div><div className="stat-label">{t('admin.exportStatUniqueUsers')}</div></div>
                  <div className="admin-stat-box"><div className="stat-value">{formatBytes(exportStats.totalFileSizeBytes)}</div><div className="stat-label">{t('admin.exportStatTotalSize')}</div></div>
                </div>
              )}
              {exportStats?.lastExport && (
                <p className="admin-info">{t('admin.exportStatLastExport')}: {new Date(exportStats.lastExport.createdAt).toLocaleString()} — {exportStats.lastExport.userDisplayName || exportStats.lastExport.userEmail}{exportStats.lastExport.templateName && ` — ${exportStats.lastExport.templateName}`}</p>
              )}
              {exportStats?.lastError && (
                <p className="admin-error">{t('admin.exportStatLastError')}: {new Date(exportStats.lastError.createdAt).toLocaleString()} — {exportStats.lastError.errorMessage || '?'}</p>
              )}
            </div>
          </details>

          {/* Export Logs */}
          <details className="admin-section">
            <summary className="admin-section-summary">📋 {t('admin.exportLogsTitle')}</summary>
            <div className="admin-section-content">
              <p className="admin-hint">{t('admin.exportLogsHelp')}</p>

              {/* Filters */}
              <div className="admin-filters">
                <select value={exportLogsFilter} onChange={(e) => { setExportLogsFilter(e.target.value); if (exportLogsLoaded) loadExportLogs(e.target.value); }}>
                  <option value="">{t('admin.exportLogsFilterAll')}</option>
                  <option value="written">{t('admin.exportLogsFilterWritten')}</option>
                  <option value="skipped">{t('admin.exportLogsFilterSkipped')}</option>
                  <option value="renamed">{t('admin.exportLogsFilterRenamed')}</option>
                  <option value="error">{t('admin.exportLogsFilterError')}</option>
                </select>
                <input type="text" placeholder={t('admin.exportLogsFilterEmail')} value={exportLogsUserEmail} onChange={(e) => setExportLogsUserEmail(e.target.value)} />
                <input type="date" title={t('admin.exportLogsFilterFrom')} value={exportLogsFrom} onChange={(e) => setExportLogsFrom(e.target.value)} />
                <input type="date" title={t('admin.exportLogsFilterTo')} value={exportLogsTo} onChange={(e) => setExportLogsTo(e.target.value)} />
              </div>
              <div className="admin-actions">
                <button disabled={exportLogsLoading} onClick={() => loadExportLogs(exportLogsFilter)}>
                  {exportLogsLoading ? t('common.loading') : exportLogsLoaded ? t('admin.exportLogsRefresh') : t('admin.exportLogsLoad')}
                </button>
                {exportLogsLoaded && <span className="admin-count">{t('admin.exportLogsCount', { shown: String(exportLogs.length), total: String(exportLogsTotal) })}</span>}
              </div>

              {exportLogsLoaded && exportLogs.length === 0 && <p className="admin-empty">{t('admin.exportLogsEmpty')}</p>}

              {exportLogs.length > 0 && (
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table-logs">
                    <thead>
                      <tr>
                        <th>{t('admin.exportLogDate')}</th>
                        <th>{t('admin.exportLogUser')}</th>
                        <th>{t('admin.exportLogTemplate')}</th>
                        <th>{t('admin.exportLogDestination')}</th>
                        <th>{t('admin.exportLogPath')}</th>
                        <th className="right">{t('admin.exportLogSize')}</th>
                        <th className="center">{t('admin.exportLogStatus')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exportLogs.map((log) => (
                        <tr key={log.id}>
                          <td className="nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                          <td title={log.userEmail}>{log.userDisplayName || log.userEmail}</td>
                          <td>{log.templateName || '—'}</td>
                          <td>{log.destinationName || '—'}{log.ruleLabelMatched && <span className="muted"> ({log.ruleLabelMatched})</span>}</td>
                          <td className="truncate" title={log.finalPath || ''}>{log.finalPath || '—'}</td>
                          <td className="right nowrap">{log.fileSizeBytes ? formatBytes(log.fileSizeBytes) : '—'}</td>
                          <td className="center"><span className={`status-badge status-${log.status}`}>{t(`admin.exportLogStatus_${log.status}`)}</span>
                            {log.errorMessage && <div className="error-truncate" title={log.errorMessage}>{log.errorMessage.length > 60 ? log.errorMessage.slice(0, 60) + '…' : log.errorMessage}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Load more */}
              {exportLogsLoaded && exportLogs.length < exportLogsTotal && (
                <div className="admin-actions center">
                  <button disabled={exportLogsLoading} onClick={() => loadExportLogs(exportLogsFilter, true)}>
                    {exportLogsLoading ? t('common.loading') : t('admin.exportLogsLoadMore', { remaining: String(exportLogsTotal - exportLogs.length) })}
                  </button>
                </div>
              )}

              {/* Purge */}
              <div className="admin-subsection">
                <h5>{t('admin.exportPurgeTitle')}</h5>
                <p className="admin-hint">{t('admin.exportPurgeHelp')}</p>
                <div className="admin-row admin-row-purge">
                  <label className="inline">
                    {t('admin.exportPurgeOlderThan')}
                    <input type="number" min={1} value={purgeDays} onChange={(e) => setPurgeDays(Math.max(1, parseInt(e.target.value) || 90))} />
                    {t('admin.exportPurgeDays')}
                  </label>
                  {!purgeConfirm ? (
                    <button onClick={() => setPurgeConfirm(true)}>🗑️ {t('admin.exportPurgeButton')}</button>
                  ) : (
                    <div className="admin-purge-confirm">
                      <span className="warning">{t('admin.exportPurgeConfirmLabel')}</span>
                      <button className="btn-danger" onClick={() => handlePurge('days')}>{t('admin.exportPurgeConfirmDays', { days: String(purgeDays) })}</button>
                      <button className="btn-danger-dark" onClick={() => handlePurge('all')}>{t('admin.exportPurgeConfirmAll')}</button>
                      <button onClick={() => { setPurgeConfirm(false); setPurgeStatus(''); }}>{t('common.cancel')}</button>
                    </div>
                  )}
                </div>
                {purgeStatus && <p className={purgeStatus.includes('✓') || purgeStatus.includes('purgé') ? 'success' : 'error'}>{purgeStatus}</p>}
              </div>
            </div>
          </details>

          {/* Governance */}
          <details className="admin-section">
            <summary className="admin-section-summary">⚖️ {t('admin.governanceTitle')}</summary>
            <div className="admin-section-content">
              <div className="admin-grid">
                <label>{t('admin.governanceAdminGroup')}<input value={settings.governance.adminGroupName || ''} onChange={(e) => update('governance.adminGroupName', e.target.value)} /></label>
                <label>{t('admin.governanceRetention')}<input type="number" value={settings.governance.retentionDays || 365} onChange={(e) => update('governance.retentionDays', Number(e.target.value))} /></label>
              </div>
              <label className="checkbox-toggle"><input type="checkbox" checked={Boolean(settings.governance.allowExternalSharing)} onChange={(e) => update('governance.allowExternalSharing', e.target.checked)} /> {t('admin.governanceExternalSharing')}</label>
            </div>
          </details>
        </div>

        {/* Status & Actions - Always visible at bottom */}
        {status && <p className="admin-status">{status}</p>}
        <div className="admin-footer">
          <button onClick={onClose}>{t('common.close')}</button>
          <button className="btn-primary" disabled={saving} onClick={async () => {
            setSaving(true);
            setStatus(t('admin.saving'));
            try {
              await saveAdminSettings(settings);
              setStatus(t('admin.settingsSaved'));
            } catch {
              setStatus(t('admin.settingsSaveError'));
            } finally {
              setSaving(false);
            }
          }}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}