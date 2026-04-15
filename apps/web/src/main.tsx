import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from './i18n';
import AppShell from './AppShell';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  </React.StrictMode>,
);
