/**
 * Holding the chosen language, and telling the document about it.
 *
 * **The `lang` attribute matters as much as the strings.** A screen reader picks its voice and its
 * pronunciation rules from `document.documentElement.lang`; leaving it at `en` while the page says
 * "Arbre genealògic" gets Catalan read aloud with English phonemes, which is worse than not
 * translating at all. So the attribute moves with the language, and so does the tab title.
 *
 * **English is on screen while another language is fetched.** `ca` and `es` arrive through a
 * dynamic import, and until one lands the English catalog answers -- a button that says "Save
 * JSON" for a moment is better than an empty one, and better than blocking the first paint on a
 * network round trip that may never be needed.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_LOCALE, loadCatalog, makeTranslate, type LocaleTag } from './catalog.js';
import { LanguageContext, type Language } from './context.js';
import { EN, type Catalog } from './keys.js';
import { openingLocale, rememberLocale } from './negotiate.js';

export interface LanguageProviderProps {
  readonly children: ReactNode;
  /** Forced language, for tests and for a caller that has already decided. */
  readonly locale?: LocaleTag;
}

/**
 * What language to start in, where there is a browser to ask.
 *
 * Guarded because this module is imported by suites that run with no DOM at all: a missing
 * `window` is not a failure, it is a context with no preference to read.
 */
function initialLocale(): LocaleTag {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  return openingLocale(window);
}

export function LanguageProvider({ children, locale: forced }: LanguageProviderProps) {
  const [chosen, setChosen] = useState<LocaleTag>(() => forced ?? initialLocale());
  const locale = forced ?? chosen;
  const [catalog, setCatalog] = useState<Catalog>(EN);

  useEffect(() => {
    let current = true;
    void loadCatalog(locale).then((loaded) => {
      /* Discarded where the language changed again while this one was in flight, so a slow fetch
         cannot overwrite a newer choice. */
      if (current) setCatalog(loaded);
    });
    return () => {
      current = false;
    };
  }, [locale]);

  const t = useMemo(() => makeTranslate(locale, catalog), [locale, catalog]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.title = t('app.title');
  }, [locale, t]);

  const setLocale = useCallback((next: LocaleTag) => {
    if (typeof window !== 'undefined') rememberLocale(next, window);
    setChosen(next);
  }, []);

  const value = useMemo<Language>(() => ({ locale, t, setLocale }), [locale, t, setLocale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
