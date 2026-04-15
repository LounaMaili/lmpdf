import { useState } from 'react';
import { login, loginMfaVerify, loginWebauthnVerify, loginPasswordlessBegin, loginPasswordlessFinish, register, setAuth, type AuthUser, type LoginResult } from '../auth';
import { useTranslation } from '../i18n';
import { startAuthentication } from '@simplewebauthn/browser';

type Props = {
  onLogin: (user: AuthUser) => void;
};

export default function LoginPage({ onLogin }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'login' | 'register' | 'mfa' | 'passwordless'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA challenge state
  const [mfaChallengeToken, setMfaChallengeToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaUserInfo, setMfaUserInfo] = useState<{ displayName?: string } | null>(null);
  const [webauthnOptions, setWebauthnOptions] = useState<any>(null);

  // V3 Passwordless email state
  const [passwordlessEmail, setPasswordlessEmail] = useState('');

  const handleLoginResult = (result: LoginResult) => {
    if (result.mfaRequired && result.mfaChallengeToken) {
      // Passer en mode MFA
      setMfaChallengeToken(result.mfaChallengeToken);
      setMfaUserInfo(result.user ? { displayName: result.user.displayName } : null);
      setWebauthnOptions(result.webauthnOptions || null);
      setMode('mfa');
      setError('');
      return;
    }

    if (result.token && result.user) {
      setAuth(result.token, result.user);
      onLogin(result.user);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'register') {
        const result = await register(email, password, displayName);
        setAuth(result.token, result.user);
        onLogin(result.user);
      } else {
        const result = await login(email, password);
        handleLoginResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await loginMfaVerify(mfaChallengeToken, mfaCode.trim());
      if (result.token && result.user) {
        setAuth(result.token, result.user);
        onLogin(result.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleWebauthnClick = async () => {
    if (!webauthnOptions) return;
    setError('');
    setLoading(true);
    try {
      const authResp = await startAuthentication(webauthnOptions);
      const result = await loginWebauthnVerify(mfaChallengeToken, authResp);
      if (result.token && result.user) {
        setAuth(result.token, result.user);
        onLogin(result.user);
      }
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        setError(err instanceof Error ? err.message : t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setMode('login');
    setMfaChallengeToken('');
    setMfaCode('');
    setMfaUserInfo(null);
    setWebauthnOptions(null);
    setPasswordlessEmail('');
    setError('');
  };

  // ─── V3 Passwordless ─────────────────────────────────────────

  const handlePasswordlessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetEmail = passwordlessEmail.trim();
    if (!targetEmail) return;
    setError('');
    setLoading(true);
    try {
      // Étape 1 : récupérer les options WebAuthn depuis le backend
      const { options } = await loginPasswordlessBegin(targetEmail);
      // Étape 2 : déclencher le navigateur / OS pour l'authentification
      const authResp = await startAuthentication(options);
      // Étape 3 : vérifier côté backend et récupérer le token
      const result = await loginPasswordlessFinish(targetEmail, authResp);
      if (result.token && result.user) {
        setAuth(result.token, result.user);
        onLogin(result.user);
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        // L'utilisateur a annulé le dialogue WebAuthn — pas d'erreur affichée
        setError('');
      } else {
        setError(err instanceof Error ? err.message : t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  // ── MFA Challenge Screen ──
  if (mode === 'mfa') {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>LMPdf</h1>
          <p className="login-subtitle">🔐 {t('mfa.loginTitle')}</p>
          {mfaUserInfo?.displayName && (
            <p className="login-mfa-user">{mfaUserInfo.displayName}</p>
          )}

          {webauthnOptions && (
            <div className="login-webauthn-section" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              <button
                type="button"
                className="login-btn mfa-btn-primary"
                onClick={handleWebauthnClick}
                disabled={loading}
              >
                🔑 {t('mfa.loginWebauthnButton')}
              </button>
              <div style={{ marginTop: '1rem', opacity: 0.7, fontSize: '0.9em' }}>
                — {t('mfa.loginOrTotp')} —
              </div>
            </div>
          )}

          <form onSubmit={handleMfaSubmit}>
            <label>
              {t('mfa.loginCodeLabel')}
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder={t('mfa.loginCodePlaceholder')}
                autoComplete="one-time-code"
                autoFocus={!webauthnOptions}
              />
            </label>
            <p className="login-mfa-hint">{t('mfa.loginHint')}</p>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" disabled={loading || !mfaCode.trim()} className="login-btn" style={{ marginTop: '1rem' }}>
              {loading ? '...' : t('mfa.loginVerify')}
            </button>
          </form>

          <p className="login-switch">
            <button onClick={handleBackToLogin}>{t('mfa.backToLogin')}</button>
          </p>
        </div>
      </div>
    );
  }

  // ── V3 Passwordless Screen ──
  if (mode === 'passwordless') {
    return (
      <div className="login-page">
        <div className="login-card">
          <h1>LMPdf</h1>
          <p className="login-subtitle">🔑 {t('auth.passwordlessTitle')}</p>

          <form onSubmit={handlePasswordlessSubmit}>
            <label>
              {t('auth.email')}
              <input
                type="email"
                value={passwordlessEmail}
                onChange={(e) => setPasswordlessEmail(e.target.value)}
                required
                placeholder={t('auth.emailPlaceholder')}
                autoFocus
              />
            </label>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" disabled={loading || !passwordlessEmail.trim()} className="login-btn mfa-btn-primary" style={{ marginTop: '1rem' }}>
              {loading ? '...' : `🔑 ${t('auth.passwordlessSubmit')}`}
            </button>
          </form>

          <p className="login-mfa-hint" style={{ marginTop: '1rem' }}>
            {t('auth.passwordlessHint')}
          </p>

          <p className="login-switch">
            <button onClick={handleBackToLogin}>{t('auth.passwordlessBackToPassword')}</button>
          </p>
        </div>
      </div>
    );
  }

  // ── Normal Login / Register Screen ──
  return (
    <div className="login-page">
      <div className="login-card">
        <h1>LMPdf</h1>
        <p className="login-subtitle">
          {mode === 'login' ? t('auth.login') : t('auth.register')}
        </p>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label>
              {t('auth.displayName')}
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                placeholder={t('auth.displayNamePlaceholder')}
              />
            </label>
          )}
          <label>
            {t('auth.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder={t('auth.emailPlaceholder')}
            />
          </label>
          <label>
            {t('auth.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder={t('auth.passwordPlaceholder')}
            />
          </label>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" disabled={loading} className="login-btn">
            {loading ? '...' : mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister')}
          </button>
        </form>

        {mode === 'login' && (
          <div style={{ textAlign: 'center', margin: '1rem 0 0.5rem' }}>
            <div style={{ opacity: 0.5, fontSize: '0.85em', margin: '0.5rem 0' }}>— {t('mfa.loginOrTotp')} —</div>
            <button
              type="button"
              className="login-btn"
              style={{ background: 'transparent', border: '1px solid #666', color: 'inherit', opacity: 0.85 }}
              onClick={() => { setMode('passwordless'); setPasswordlessEmail(email); setError(''); }}
            >
              🔑 {t('auth.passwordlessButton')}
            </button>
          </div>
        )}

        <p className="login-switch">
          {mode === 'login' ? (
            <>{t('auth.noAccount')} <button onClick={() => setMode('register')}>{t('auth.register')}</button></>
          ) : (
            <>{t('auth.hasAccount')} <button onClick={() => setMode('login')}>{t('auth.submitLogin')}</button></>
          )}
        </p>
      </div>
    </div>
  );
}
