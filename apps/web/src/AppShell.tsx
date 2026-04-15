import { lazy, Suspense, useEffect, useState } from 'react';
import App from './App';
import LoginPage from './components/LoginPage';
import { getStoredUser, fetchMe, clearAuth, setAuth, type AuthUser } from './auth';
import { useTranslation } from './i18n';

const AdminSettingsPanel = lazy(() => import('./components/AdminSettingsPanel'));
const MfaSettingsPanel = lazy(() => import('./components/MfaSettingsPanel'));

export default function AppShell() {
  const { t } = useTranslation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [showMfaSettings, setShowMfaSettings] = useState(false);

  useEffect(() => {
    // Try to restore session from localStorage
    const stored = getStoredUser();
    if (stored) {
      // Verify token is still valid
      fetchMe().then((u) => {
        if (u) {
          setUser(u);
          // Update stored user with fresh data (includes mfaEnabled, mfaPolicy)
          const token = localStorage.getItem('lmpdf_token');
          if (token) setAuth(token, u);
        }
        setLoading(false);
      }).catch(() => {
        clearAuth();
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogout = () => {
    clearAuth();
    setUser(null);
  };

  const handleMfaChanged = () => {
    // Refresh user data
    fetchMe().then((u) => {
      if (u) {
        setUser(u);
        const token = localStorage.getItem('lmpdf_token');
        if (token) setAuth(token, u);
      }
    }).catch(() => {});
  };

  if (loading) {
    return <div className="loading-screen">{t('common.loading')}</div>;
  }

  if (!user) {
    return <LoginPage onLogin={(u) => setUser(u)} />;
  }

  return (
    <div className="app-shell">
      <App
        currentUser={user}
        onLogout={handleLogout}
        onShowAdminSettings={user.role === 'admin' ? () => setShowAdminSettings(true) : undefined}
        onShowMfaSettings={user.authSource === 'local' ? () => setShowMfaSettings(true) : undefined}
      />
      {showAdminSettings && (
        <Suspense fallback={null}>
          <AdminSettingsPanel onClose={() => setShowAdminSettings(false)} />
        </Suspense>
      )}
      {showMfaSettings && (
        <Suspense fallback={null}>
          <div className="modal-overlay" onClick={() => setShowMfaSettings(false)}>
            <div className="modal-content mfa-modal" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setShowMfaSettings(false)}>×</button>
              <MfaSettingsPanel onMfaChanged={handleMfaChanged} />
            </div>
          </div>
        </Suspense>
      )}
    </div>
  );
}
