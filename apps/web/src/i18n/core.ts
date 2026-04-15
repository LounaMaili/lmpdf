/**
 * Core i18n logic — no React dependency.
 * Usable in non-component code (utils, API helpers, etc.).
 */

import fr from './locales/fr.json';
import en from './locales/en.json';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Locale = 'fr' | 'en';

/** Recursive string dictionary */
export type TranslationDictionary = {
  [key: string]: string | TranslationDictionary;
};

// ─── Constants ───────────────────────────────────────────────────────────────

export const SUPPORTED_LOCALES: readonly Locale[] = ['fr', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'fr';

const STORAGE_KEY = 'lmpdf_locale';

// ─── Dictionaries ────────────────────────────────────────────────────────────

const dictionaries: Record<Locale, TranslationDictionary> = {
  fr: fr as unknown as TranslationDictionary,
  en: en as unknown as TranslationDictionary,
};

// ─── Locale persistence ──────────────────────────────────────────────────────

export function getLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) {
      return stored as Locale;
    }
  } catch {
    // SSR or restricted storage — ignore
  }
  return DEFAULT_LOCALE;
}

export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

// ─── Resolve a dot-notated key from a dictionary ─────────────────────────────

function resolve(dict: TranslationDictionary, key: string): string | undefined {
  const parts = key.split('.');
  let current: TranslationDictionary | string = dict;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as TranslationDictionary)[part];
    if (current === undefined) return undefined;
  }
  return typeof current === 'string' ? current : undefined;
}

// ─── Interpolation ───────────────────────────────────────────────────────────

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = params[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}

// ─── Translation function factory ────────────────────────────────────────────

export function createT(locale: Locale) {
  const dict = dictionaries[locale];
  const fallback = dictionaries[DEFAULT_LOCALE];

  /**
   * Translate a key with optional interpolation.
   *
   * @example
   *   t('auth.login')                       // → "Connexion"
   *   t('status.uploadOk', { name: 'a.pdf' }) // → "Upload OK: a.pdf"
   */
  return function t(key: string, params?: Record<string, string | number>): string {
    const raw = resolve(dict, key) ?? resolve(fallback, key) ?? key;
    return interpolate(raw, params);
  };
}
