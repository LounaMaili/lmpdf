import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { createT, getLocale, setLocale as persistLocale, type Locale } from './core';

// ─── Context shape ───────────────────────────────────────────────────────────

export interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

interface Props {
  /** Override the initial locale (useful for tests). Falls back to stored / default. */
  initialLocale?: Locale;
  children: ReactNode;
}

export function I18nProvider({ initialLocale, children }: Props) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? getLocale());

  const setLocale = useCallback((l: Locale) => {
    persistLocale(l);
    setLocaleState(l);
  }, []);

  const t = useMemo(() => createT(locale), [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}
