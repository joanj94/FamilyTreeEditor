/**
 * The current language, as React sees it.
 *
 * **The default value is a working English translator, not a null.** A component calling `useT()`
 * outside a provider gets correct English rather than a crash or a screenful of raw keys, which is
 * what lets every existing test go on rendering a component on its own and asserting the English
 * it has always asserted. Mounting `LanguageProvider` is what adds the ability to *change*
 * language; it is not what makes the strings work.
 *
 * Kept apart from the provider so this file exports no components: a module mixing hooks and
 * components defeats fast refresh, and `react-refresh/only-export-components` says so.
 */
import { createContext, useContext } from 'react';

import { DEFAULT_LOCALE, makeTranslate, type LocaleTag } from './catalog.js';
import { EN, type Translate } from './keys.js';

export interface Language {
  readonly locale: LocaleTag;
  readonly t: Translate;
  readonly setLocale: (next: LocaleTag) => void;
}

export const LanguageContext = createContext<Language>({
  locale: DEFAULT_LOCALE,
  t: makeTranslate(DEFAULT_LOCALE, EN),
  /* No provider means no way to change language, which is the honest answer rather than a throw:
     the strings still render, and only the picker is missing. */
  setLocale: () => undefined,
});

/** The whole language state: what it is, how to say things, how to change it. */
export function useLanguage(): Language {
  return useContext(LanguageContext);
}

/** Just the translator, which is all most components want. */
export function useT(): Translate {
  return useContext(LanguageContext).t;
}
