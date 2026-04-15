import { useContext } from 'react';
import { I18nContext, type I18nContextValue } from './provider';

/**
 * Access the i18n context from any component.
 *
 * @example
 *   const { t, locale, setLocale } = useTranslation();
 *   <button>{t('auth.login')}</button>
 */
export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useTranslation() must be used inside <I18nProvider>');
  }
  return ctx;
}
