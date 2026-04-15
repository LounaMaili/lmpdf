/**
 * i18n — Lightweight internationalisation for LMPdf.
 *
 * Design goals:
 *  - Zero external dependency (no i18next, react-intl, etc.)
 *  - JSON dictionaries living in ./locales/{lang}.json
 *  - React context + hook (`useTranslation`) for components
 *  - Simple interpolation: "Hello {name}" → t('key', { name: 'Alice' })
 *  - Nested keys via dot notation: t('auth.login')
 *  - Falls back to French (`fr`) when a key is missing in the active locale
 *  - Prepared for per-user language preference (just call `setLocale`)
 */

export { I18nProvider } from './provider';
export { useTranslation } from './hook';
export { getLocale, setLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from './core';
export type { Locale, TranslationDictionary } from './core';
