'use client';
import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_LOCALE, type Locale } from './locales';
import { makeT, type Translate } from './translate';

export type { Translate };

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => makeT(locale), [locale]);
}
