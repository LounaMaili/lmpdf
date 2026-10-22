import { useState } from 'react';
import MfaSettingsPanel from './MfaSettingsPanel';

export default function MfaEnrollmentPage({ onLogout }: { onLogout: () => void }) {
  const [complete, setComplete] = useState(false);
  return <div className="login-page"><div className="login-card">
    <h1>LMPdf</h1>
    <h2>Activer un second facteur</h2>
    <p>L’accès aux documents et à l’administration nécessite un facteur MFA actif.</p>
    <MfaSettingsPanel enrollmentOnly onMfaChanged={() => setComplete(true)} />
    {complete && <p>Conservez vos codes de secours, puis reconnectez-vous avec votre second facteur.</p>}
    <button className="login-btn" onClick={onLogout}>
      {complete ? 'Continuer vers la connexion' : 'Annuler et revenir à la connexion'}
    </button>
  </div></div>;
}
