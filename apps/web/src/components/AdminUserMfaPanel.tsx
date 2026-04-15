import { useEffect, useState } from 'react';
import {
  getAdminUsers,
  getAdminUserMfaStatus,
  adminResetTotp,
  adminDeleteAllBackupCodes,
  adminDeleteWebauthnCredential,
  adminDeleteAllWebauthnCredentials,
  adminResetAllMfa,
} from '../api';
import type { AdminUserListEntry, AdminUserMfaStatus } from '../api';
import { useTranslation } from '../i18n';

type Props = { onClose: () => void };

type ConfirmAction =
  | null
  | 'resetTotp'
  | 'deleteBackupCodes'
  | 'deleteAllWebauthn'
  | 'resetAll'
  | { type: 'deleteWebauthnKey'; credentialId: string; label: string };

export default function AdminUserMfaPanel({ onClose }: Props) {
  const { t } = useTranslation();

  // Liste des utilisateurs
  const [users, setUsers] = useState<AdminUserListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Utilisateur sélectionné
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [mfaStatus, setMfaStatus] = useState<AdminUserMfaStatus | null>(null);
  const [mfaLoading, setMfaLoading] = useState(false);

  // Confirmation + feedback
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [actionStatus, setActionStatus] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Charger la liste des utilisateurs
  useEffect(() => {
    getAdminUsers()
      .then((u) => {
        setUsers(u);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Charger le détail MFA quand on sélectionne un user
  const loadMfaStatus = async (userId: string) => {
    setSelectedUserId(userId);
    setMfaStatus(null);
    setMfaLoading(true);
    setConfirmAction(null);
    setActionStatus('');
    try {
      const status = await getAdminUserMfaStatus(userId);
      setMfaStatus(status);
    } catch (e: any) {
      setActionStatus(e.message || t('common.error'));
    } finally {
      setMfaLoading(false);
    }
  };

  // Exécuter une action admin
  const executeAction = async (action: ConfirmAction) => {
    if (!selectedUserId || !action) return;
    setActionLoading(true);
    setActionStatus('');
    try {
      let result: any;
      switch (action) {
        case 'resetTotp':
          result = await adminResetTotp(selectedUserId);
          break;
        case 'deleteBackupCodes':
          result = await adminDeleteAllBackupCodes(selectedUserId);
          break;
        case 'deleteAllWebauthn':
          result = await adminDeleteAllWebauthnCredentials(selectedUserId);
          break;
        case 'resetAll':
          result = await adminResetAllMfa(selectedUserId);
          break;
        default:
          if (typeof action === 'object' && action.type === 'deleteWebauthnKey') {
            result = await adminDeleteWebauthnCredential(selectedUserId, action.credentialId);
          }
      }
      setActionStatus(`✓ ${result?.message || t('common.ok')}`);
      setConfirmAction(null);
      // Recharger l'état
      await loadMfaStatus(selectedUserId);
      // Rafraîchir aussi la ligne dans la liste
      refreshUserInList(selectedUserId);
    } catch (e: any) {
      setActionStatus(`✗ ${e.message || t('common.error')}`);
    } finally {
      setActionLoading(false);
    }
  };

  const refreshUserInList = async (userId: string) => {
    try {
      const allUsers = await getAdminUsers();
      setUsers(allUsers);
    } catch {
      // silently ignore
    }
  };

  // Filtrer les utilisateurs
  const filteredUsers = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q)
    );
  });

  const getConfirmLabel = (): string => {
    if (!confirmAction) return '';
    switch (confirmAction) {
      case 'resetTotp':
        return t('adminMfa.confirmResetTotp');
      case 'deleteBackupCodes':
        return t('adminMfa.confirmDeleteBackupCodes');
      case 'deleteAllWebauthn':
        return t('adminMfa.confirmDeleteAllWebauthn');
      case 'resetAll':
        return t('adminMfa.confirmResetAll');
      default:
        if (typeof confirmAction === 'object' && confirmAction.type === 'deleteWebauthnKey') {
          return t('adminMfa.confirmDeleteWebauthnKey', { label: confirmAction.label });
        }
        return '';
    }
  };

  // ─── MFA state badges ───

  const mfaBadge = (user: AdminUserListEntry) => {
    const parts: string[] = [];
    if (user.mfaEnabled) parts.push('🔐 TOTP');
    if (user.webauthnKeysCount > 0) parts.push(`🔑 ${user.webauthnKeysCount}`);
    if (user.backupCodesCount > 0) parts.push(`📋 ${user.backupCodesCount}`);
    return parts.length > 0 ? parts.join(' · ') : '—';
  };

  if (loading) {
    return (
      <div className="modal-backdrop">
        <div className="modal">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 900, maxHeight: '90vh', overflow: 'auto' }}>
        <h3>🛡️ {t('adminMfa.title')}</h3>
        <p style={{ fontSize: 13, color: '#666', margin: '0 0 12px' }}>
          {t('adminMfa.subtitle')}
        </p>

        {/* Barre de recherche */}
        <input
          type="text"
          placeholder={t('adminMfa.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', marginBottom: 12, fontSize: 14, padding: '6px 10px' }}
        />

        <div style={{ display: 'flex', gap: 16 }}>
          {/* ─── Colonne gauche : liste utilisateurs ─── */}
          <div style={{ flex: '0 0 340px', maxHeight: 500, overflowY: 'auto', borderRight: '1px solid #eee', paddingRight: 12 }}>
            {filteredUsers.length === 0 && (
              <p style={{ fontSize: 13, color: '#888' }}>{t('adminMfa.noUsers')}</p>
            )}
            {filteredUsers.map((u) => (
              <div
                key={u.id}
                onClick={() => loadMfaStatus(u.id)}
                style={{
                  padding: '8px 10px',
                  marginBottom: 4,
                  borderRadius: 6,
                  cursor: 'pointer',
                  backgroundColor: selectedUserId === u.id ? '#e8f0fe' : 'transparent',
                  border: selectedUserId === u.id ? '1px solid #4285f4' : '1px solid transparent',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {u.displayName}
                  {!u.isActive && <span style={{ color: '#999', fontWeight: 400 }}> ({t('adminMfa.inactive')})</span>}
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>{u.email}</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {u.role} · {u.authSource} · {mfaBadge(u)}
                </div>
              </div>
            ))}
          </div>

          {/* ─── Colonne droite : détail MFA ─── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {!selectedUserId && (
              <p style={{ fontSize: 13, color: '#888', textAlign: 'center', marginTop: 40 }}>
                ← {t('adminMfa.selectUser')}
              </p>
            )}

            {mfaLoading && <p>{t('common.loading')}</p>}

            {mfaStatus && !mfaLoading && (
              <>
                <h4 style={{ margin: '0 0 8px' }}>
                  {mfaStatus.displayName} <span style={{ fontWeight: 400, fontSize: 13, color: '#666' }}>({mfaStatus.email})</span>
                </h4>

                {/* ─── Résumé état MFA ─── */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    gap: '4px 12px',
                    fontSize: 13,
                    marginBottom: 16,
                    padding: 10,
                    backgroundColor: '#f8f9fa',
                    borderRadius: 6,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>TOTP :</span>
                  <span>
                    {mfaStatus.mfaEnabled ? (
                      <span style={{ color: '#28a745' }}>✓ {t('adminMfa.totpActive')}</span>
                    ) : mfaStatus.totpConfigured ? (
                      <span style={{ color: '#ffc107' }}>⚠ {t('adminMfa.totpConfiguredNotEnabled')}</span>
                    ) : (
                      <span style={{ color: '#6c757d' }}>— {t('adminMfa.totpNotConfigured')}</span>
                    )}
                  </span>

                  <span style={{ fontWeight: 600 }}>{t('adminMfa.backupCodesLabel')} :</span>
                  <span>
                    {mfaStatus.backupCodes.total > 0 ? (
                      <>
                        {mfaStatus.backupCodes.remaining}/{mfaStatus.backupCodes.total}{' '}
                        {t('adminMfa.remaining')}
                        {mfaStatus.backupCodes.used > 0 && (
                          <span style={{ color: '#888' }}> ({mfaStatus.backupCodes.used} {t('adminMfa.used')})</span>
                        )}
                      </>
                    ) : (
                      <span style={{ color: '#6c757d' }}>— {t('adminMfa.noCodes')}</span>
                    )}
                  </span>

                  <span style={{ fontWeight: 600 }}>{t('adminMfa.webauthnLabel')} :</span>
                  <span>
                    {mfaStatus.webauthnCount > 0 ? (
                      <span style={{ color: '#28a745' }}>
                        {mfaStatus.webauthnCount} {t('adminMfa.keysRegistered')}
                      </span>
                    ) : (
                      <span style={{ color: '#6c757d' }}>— {t('adminMfa.noKeys')}</span>
                    )}
                  </span>
                </div>

                {/* ─── Liste clés WebAuthn ─── */}
                {mfaStatus.webauthnCredentials.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <h5 style={{ margin: '0 0 6px' }}>🔑 {t('adminMfa.webauthnKeys')}</h5>
                    {mfaStatus.webauthnCredentials.map((cred) => (
                      <div
                        key={cred.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '4px 8px',
                          marginBottom: 3,
                          backgroundColor: '#f0f0f0',
                          borderRadius: 4,
                          fontSize: 12,
                        }}
                      >
                        <div>
                          <strong>{cred.label}</strong>
                          <span style={{ color: '#888', marginLeft: 8 }}>
                            {new Date(cred.createdAt).toLocaleDateString()}
                          </span>
                          {cred.lastUsedAt && (
                            <span style={{ color: '#888', marginLeft: 6 }}>
                              ({t('adminMfa.lastUsed')}: {new Date(cred.lastUsedAt).toLocaleDateString()})
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() =>
                            setConfirmAction({
                              type: 'deleteWebauthnKey',
                              credentialId: cred.id,
                              label: cred.label,
                            })
                          }
                          style={{ fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}
                          disabled={actionLoading}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* ─── Actions admin ─── */}
                <h5 style={{ margin: '0 0 8px' }}>⚡ {t('adminMfa.actionsTitle')}</h5>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {(mfaStatus.mfaEnabled || mfaStatus.totpConfigured) && (
                    <button
                      onClick={() => setConfirmAction('resetTotp')}
                      disabled={actionLoading}
                      style={{ fontSize: 13 }}
                    >
                      🔄 {t('adminMfa.actionResetTotp')}
                    </button>
                  )}
                  {mfaStatus.backupCodes.total > 0 && (
                    <button
                      onClick={() => setConfirmAction('deleteBackupCodes')}
                      disabled={actionLoading}
                      style={{ fontSize: 13 }}
                    >
                      📋 {t('adminMfa.actionDeleteBackupCodes')}
                    </button>
                  )}
                  {mfaStatus.webauthnCount > 0 && (
                    <button
                      onClick={() => setConfirmAction('deleteAllWebauthn')}
                      disabled={actionLoading}
                      style={{ fontSize: 13 }}
                    >
                      🔑 {t('adminMfa.actionDeleteAllWebauthn')}
                    </button>
                  )}
                  {(mfaStatus.mfaEnabled || mfaStatus.totpConfigured || mfaStatus.backupCodes.total > 0 || mfaStatus.webauthnCount > 0) && (
                    <button
                      onClick={() => setConfirmAction('resetAll')}
                      disabled={actionLoading}
                      style={{
                        fontSize: 13,
                        backgroundColor: '#dc3545',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '4px 12px',
                        cursor: 'pointer',
                      }}
                    >
                      💣 {t('adminMfa.actionResetAll')}
                    </button>
                  )}
                  {!mfaStatus.mfaEnabled && !mfaStatus.totpConfigured && mfaStatus.backupCodes.total === 0 && mfaStatus.webauthnCount === 0 && (
                    <p style={{ fontSize: 13, color: '#888' }}>{t('adminMfa.noMfaConfigured')}</p>
                  )}
                </div>

                {/* ─── Confirmation dialog ─── */}
                {confirmAction && (
                  <div
                    style={{
                      padding: 12,
                      marginBottom: 12,
                      backgroundColor: '#fff3cd',
                      border: '1px solid #ffc107',
                      borderRadius: 6,
                    }}
                  >
                    <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 13 }}>
                      ⚠️ {getConfirmLabel()}
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => executeAction(confirmAction)}
                        disabled={actionLoading}
                        style={{
                          fontSize: 13,
                          backgroundColor: '#dc3545',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          padding: '4px 12px',
                          cursor: 'pointer',
                        }}
                      >
                        {actionLoading ? t('common.loading') : t('adminMfa.confirmExecute')}
                      </button>
                      <button
                        onClick={() => {
                          setConfirmAction(null);
                          setActionStatus('');
                        }}
                        disabled={actionLoading}
                        style={{ fontSize: 13 }}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {/* ─── Feedback ─── */}
                {actionStatus && (
                  <p
                    style={{
                      fontSize: 13,
                      color: actionStatus.startsWith('✓') ? '#28a745' : '#dc3545',
                      margin: '4px 0',
                    }}
                  >
                    {actionStatus}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* ─── Bouton fermer ─── */}
        <div className="buttons" style={{ marginTop: 16 }}>
          <button onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}
