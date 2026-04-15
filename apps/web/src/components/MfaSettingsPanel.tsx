import { useState, useEffect } from 'react';
import {
  getMfaStatus,
  startMfaSetup,
  confirmMfaSetup,
  disableMfa,
  regenerateBackupCodes,
  listWebauthnCredentials,
  beginWebauthnRegistration,
  finishWebauthnRegistration,
  deleteWebauthnCredential,
  type WebAuthnCredential
} from '../api';
import type { MfaStatus, MfaSetupResult } from '../api';
import { useTranslation } from '../i18n';
import { startRegistration } from '@simplewebauthn/browser';

type Props = {
  onMfaChanged?: () => void;
};

export default function MfaSettingsPanel({ onMfaChanged }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [webauthnKeys, setWebauthnKeys] = useState<WebAuthnCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // TOTP Setup flow
  const [setupData, setSetupData] = useState<MfaSetupResult | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // TOTP Disable flow
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  // TOTP Regenerate flow
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');

  // WebAuthn Add flow
  const [showAddKey, setShowAddKey] = useState(false);
  const [keyPassword, setKeyPassword] = useState('');
  const [keyLabel, setKeyLabel] = useState('');
  const [webauthnLoading, setWebauthnLoading] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [s, keys] = await Promise.all([
        getMfaStatus(),
        listWebauthnCredentials().catch(() => []),
      ]);
      setStatus(s);
      setWebauthnKeys(keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // ── TOTP ──
  const handleStartSetup = async () => {
    try {
      setError('');
      const data = await startMfaSetup();
      setSetupData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const handleConfirmSetup = async () => {
    if (!setupData || !totpCode.trim()) return;
    try {
      setError('');
      const result = await confirmMfaSetup(setupData.secret, totpCode.trim());
      if (result.success) {
        setBackupCodes(result.backupCodes);
        setSetupData(null);
        setTotpCode('');
        setMessage(t('mfa.setupSuccess'));
        await loadData();
        onMfaChanged?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const handleDisable = async () => {
    try {
      setError('');
      await disableMfa(disablePassword);
      setShowDisable(false);
      setDisablePassword('');
      setMessage(t('mfa.disableSuccess'));
      setBackupCodes(null);
      await loadData();
      onMfaChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const handleRegenerate = async () => {
    try {
      setError('');
      const result = await regenerateBackupCodes(regenPassword);
      if (result.success) {
        setBackupCodes(result.backupCodes);
        setShowRegenerate(false);
        setRegenPassword('');
        setMessage(t('mfa.regenerateSuccess'));
        await loadData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  // ── WebAuthn ──
  const handleAddKey = async () => {
    try {
      setError('');
      setWebauthnLoading(true);
      const options = await beginWebauthnRegistration(keyPassword);
      let authResp;
      try {
        authResp = await startRegistration(options);
      } catch (e: any) {
        throw new Error(e.message || 'Erreur navigateur WebAuthn');
      }
      
      const result = await finishWebauthnRegistration(authResp, keyLabel || 'Clé de sécurité');
      if (result.success) {
        setMessage(t('mfa.webauthnAddSuccess'));
        setShowAddKey(false);
        setKeyPassword('');
        setKeyLabel('');
        await loadData();
        onMfaChanged?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setWebauthnLoading(false);
    }
  };

  const handleDeleteKey = async (id: string) => {
    if (!confirm(t('mfa.webauthnDeleteConfirm'))) return;
    try {
      setError('');
      await deleteWebauthnCredential(id);
      setMessage(t('mfa.webauthnDeleteSuccess'));
      await loadData();
      onMfaChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    }
  };

  if (loading) return <div className="mfa-panel">{t('common.loading')}</div>;

  if (status?.policy === 'disabled') {
    return (
      <div className="mfa-panel">
        <h3>🔐 {t('mfa.title')}</h3>
        <p className="mfa-info">{t('mfa.disabledByAdmin')}</p>
      </div>
    );
  }

  return (
    <div className="mfa-panel">
      <h3>🔐 {t('mfa.title')}</h3>

      {error && <p className="mfa-error">{error}</p>}
      {message && <p className="mfa-success">{message}</p>}

      {status?.policy === 'required' && !status?.mfaEnabled && webauthnKeys.length === 0 && (
        <p className="mfa-warning">⚠️ {t('mfa.requiredWarning')}</p>
      )}

      {/* ── Section WebAuthn (Passkeys) ── */}
      <div className="mfa-section">
        <h4>🔑 {t('mfa.webauthnTitle')}</h4>
        <p className="mfa-info">{t('mfa.webauthnHelp')}</p>

        {webauthnKeys.length > 0 && (
          <ul className="mfa-keys-list">
            {webauthnKeys.map((key) => (
              <li key={key.id} className="mfa-key-item">
                <span className="mfa-key-label">{key.label}</span>
                <span className="mfa-key-date">
                  {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : ''}
                </span>
                <button
                  className="mfa-btn-icon"
                  title={t('common.delete')}
                  onClick={() => handleDeleteKey(key.id)}
                >
                  ❌
                </button>
              </li>
            ))}
          </ul>
        )}

        {!showAddKey ? (
          <button className="mfa-btn mfa-btn-primary" onClick={() => setShowAddKey(true)}>
            ➕ {t('mfa.webauthnAddButton')}
          </button>
        ) : (
          <div className="mfa-confirm-action">
            <label className="mfa-input-label">
              {t('mfa.webauthnKeyLabel')}
              <input
                type="text"
                value={keyLabel}
                onChange={(e) => setKeyLabel(e.target.value)}
                placeholder="YubiKey, iPhone..."
                className="mfa-input"
              />
            </label>
            <label className="mfa-input-label">
              {t('mfa.confirmPassword')}
              <input
                type="password"
                value={keyPassword}
                onChange={(e) => setKeyPassword(e.target.value)}
                className="mfa-input"
              />
            </label>
            <div className="mfa-btn-row">
              <button
                className="mfa-btn mfa-btn-primary"
                onClick={handleAddKey}
                disabled={!keyPassword || webauthnLoading}
              >
                {webauthnLoading ? '...' : t('mfa.webauthnAddConfirm')}
              </button>
              <button className="mfa-btn mfa-btn-secondary" onClick={() => { setShowAddKey(false); setKeyPassword(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      <hr className="mfa-divider" />

      {/* ── Section TOTP ── */}
      <div className="mfa-section">
        <h4>📱 {t('mfa.totpTitle')}</h4>
        <div className="mfa-status-row">
          <span>{t('mfa.statusLabel')}</span>
          <span className={`mfa-badge ${status?.mfaEnabled ? 'enabled' : 'disabled'}`}>
            {status?.mfaEnabled ? t('mfa.enabled') : t('mfa.notEnabled')}
          </span>
        </div>

        {/* Backup codes affichés */}
        {backupCodes && (
          <div className="mfa-backup-codes">
            <h4>🔑 {t('mfa.backupCodesTitle')}</h4>
            <p className="mfa-warning">{t('mfa.backupCodesWarning')}</p>
            <div className="mfa-codes-grid">
              {backupCodes.map((code, i) => (
                <code key={i} className="mfa-code">{code}</code>
              ))}
            </div>
            <button
              className="mfa-btn"
              onClick={() => {
                navigator.clipboard.writeText(backupCodes.join('\n')).catch(() => {});
                setMessage(t('mfa.codesCopied'));
              }}
            >
              📋 {t('mfa.copyBackupCodes')}
            </button>
            <button className="mfa-btn mfa-btn-secondary" onClick={() => setBackupCodes(null)}>
              {t('mfa.hideBackupCodes')}
            </button>
          </div>
        )}

        {/* Setup TOTP */}
        {!status?.mfaEnabled && !setupData && (
          <button className="mfa-btn mfa-btn-primary" onClick={handleStartSetup}>
            🔐 {t('mfa.enableButton')}
          </button>
        )}

        {setupData && (
          <div className="mfa-setup">
            <p>{t('mfa.setupInstructions')}</p>
            <div className="mfa-qr-container">
              <img src={setupData.qrCodeDataUrl} alt="QR Code TOTP" className="mfa-qr" />
            </div>
            <details className="mfa-secret-details">
              <summary>{t('mfa.showManualKey')}</summary>
              <code className="mfa-secret-code">{setupData.secret}</code>
            </details>
            <label className="mfa-input-label">
              {t('mfa.enterCode')}
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="mfa-input"
                autoComplete="one-time-code"
              />
            </label>
            <div className="mfa-btn-row">
              <button className="mfa-btn mfa-btn-primary" onClick={handleConfirmSetup} disabled={totpCode.length !== 6}>
                ✅ {t('mfa.confirmSetup')}
              </button>
              <button className="mfa-btn mfa-btn-secondary" onClick={() => { setSetupData(null); setTotpCode(''); }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Actions TOTP */}
        {status?.mfaEnabled && !backupCodes && (
          <div className="mfa-actions">
            <div className="mfa-status-detail">
              <span>🔑 {t('mfa.backupCodesRemaining')}: </span>
              <strong>{status.backupCodesRemaining} / {status.backupCodesTotal}</strong>
            </div>

            {!showRegenerate ? (
              <button className="mfa-btn" onClick={() => setShowRegenerate(true)}>
                🔄 {t('mfa.regenerateButton')}
              </button>
            ) : (
              <div className="mfa-confirm-action">
                <label className="mfa-input-label">
                  {t('mfa.confirmPassword')}
                  <input
                    type="password"
                    value={regenPassword}
                    onChange={(e) => setRegenPassword(e.target.value)}
                    className="mfa-input"
                  />
                </label>
                <div className="mfa-btn-row">
                  <button className="mfa-btn mfa-btn-primary" onClick={handleRegenerate} disabled={!regenPassword}>
                    {t('mfa.regenerateConfirm')}
                  </button>
                  <button className="mfa-btn mfa-btn-secondary" onClick={() => { setShowRegenerate(false); setRegenPassword(''); }}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}

            {!showDisable ? (
              <button className="mfa-btn mfa-btn-danger" onClick={() => setShowDisable(true)}>
                ❌ {t('mfa.disableButton')}
              </button>
            ) : (
              <div className="mfa-confirm-action">
                <label className="mfa-input-label">
                  {t('mfa.confirmPassword')}
                  <input
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    className="mfa-input"
                  />
                </label>
                <div className="mfa-btn-row">
                  <button className="mfa-btn mfa-btn-danger" onClick={handleDisable} disabled={!disablePassword}>
                    {t('mfa.disableConfirm')}
                  </button>
                  <button className="mfa-btn mfa-btn-secondary" onClick={() => { setShowDisable(false); setDisablePassword(''); }}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
