/**
 * Which language to open in.
 *
 * A choice the user made outranks everything, because they made it here and meant it. Failing
 * that, the languages the browser says they read, in their order of preference -- matched on the
 * base tag, so `es-AR` and `ca-ES` find `es` and `ca` rather than falling through to English for
 * want of an exact string. Failing that, English.
 *
 * **A refused `localStorage` is not an error here.** In a private window, or with site data
 * switched off, reading the preference throws -- and the honest response is to open in the
 * browser's language, which is exactly what happens with no preference stored. This is the one
 * place a caught exception is discarded rather than reported, because there is nothing to report:
 * no preference was saved, and none could have been.
 */
import { DEFAULT_LOCALE, isLocale, type LocaleTag } from './catalog.js';

/** Namespaced, because a page's storage is shared with everything else the origin keeps. */
export const LOCALE_STORAGE_KEY = 'familytree.locale';

/** The language the user last chose, if this browser is willing to remember anything. */
export function storedLocale(scope: Pick<Window, 'localStorage'>): LocaleTag | undefined {
  try {
    const found = scope.localStorage.getItem(LOCALE_STORAGE_KEY);
    return found !== null && isLocale(found) ? found : undefined;
  } catch {
    return undefined;
  }
}

/** Remember a choice. Silently does nothing where this browser keeps nothing. */
export function rememberLocale(locale: LocaleTag, scope: Pick<Window, 'localStorage'>): void {
  try {
    scope.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* Nothing to do and nothing to say: see the module comment. */
  }
}

/**
 * The best supported language for a list of preferences.
 *
 * `navigator.languages` is in the user's own order, so the first match wins. Region is dropped
 * before matching: this editor translates languages, not locales, and `ca-ES` wanting Catalan is
 * not a near-miss.
 */
export function negotiate(preferred: readonly string[]): LocaleTag {
  for (const tag of preferred) {
    const base = tag.split('-')[0]?.toLowerCase();
    if (base !== undefined && isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** What the app should open in: the stored choice, else the browser's preference. */
export function openingLocale(
  scope: Pick<Window, 'localStorage'> & { readonly navigator: Pick<Navigator, 'languages'> },
): LocaleTag {
  return storedLocale(scope) ?? negotiate(scope.navigator.languages);
}
