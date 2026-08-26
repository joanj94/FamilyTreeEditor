/**
 * Looking a message up, in one language, with English underneath.
 *
 * **English is always loaded and is always the floor.** A translation that has fallen behind the
 * app shows the English sentence rather than a raw key: a Catalan user meeting `bar.saveJson` has
 * been shown a bug, whereas one meeting "Save JSON" has been shown a button that works. The key
 * itself is only ever returned when English has not got the entry either, which the catalog test
 * makes impossible.
 *
 * **Only the chosen language is downloaded.** `en` is bundled because it is the fallback and the
 * type; `ca` and `es` arrive through a dynamic import, so a reader who never switches never pays
 * for them.
 */
import { interpolate, pluralCategory } from './format.js';
import {
  EN,
  type Catalog,
  type MessageKey,
  type MessageParams,
  type MessageRef,
  type Translate,
} from './keys.js';

export const LOCALES = ['en', 'ca', 'es'] as const;

export type LocaleTag = (typeof LOCALES)[number];

/** The one language that is complete by construction. */
export const DEFAULT_LOCALE: LocaleTag = 'en';

export function isLocale(value: string): value is LocaleTag {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * The entry a key and its params resolve to, before substitution.
 *
 * A `count` param selects a plural form: the category this locale wants, then `other` as the
 * catch-all, then the bare key for the many messages that have no plural at all.
 */
function entryFor(
  catalog: Catalog,
  key: MessageKey,
  locale: string,
  params: MessageParams | undefined,
): string | undefined {
  const count = params?.['count'];
  if (typeof count === 'number') {
    /* `other` behind the locale own category, so a translation that has not filled in a rare form
       still renders a correct sentence for every ordinary count. */
    const chosen =
      catalog[`${key}_${pluralCategory(locale, count)}`] ?? catalog[`${key}_other`];
    if (chosen !== undefined) return chosen;
  }
  return catalog[key];
}

/**
 * A `t` bound to one language.
 *
 * Accepts either a bare key -- what a component writes -- or a whole `MessageRef`, which is what
 * `audit()`, `commands.ts` and the exporter hand upwards. Extra params passed alongside a ref win
 * over the ones baked into it, so a caller can fill in something the producer could not know.
 */
export function makeTranslate(locale: LocaleTag, catalog: Catalog): Translate {
  return (keyOrRef: MessageKey | MessageRef, extra?: MessageParams): string => {
    const isRef = typeof keyOrRef !== 'string';
    const key = isRef ? keyOrRef.key : keyOrRef;
    const own = isRef ? keyOrRef.params : undefined;
    const params = own === undefined ? extra : extra === undefined ? own : { ...own, ...extra };

    const template =
      entryFor(catalog, key, locale, params) ?? entryFor(EN, key, DEFAULT_LOCALE, params);
    /* Not a thrown error: a missing string must not take the screen down with it, and the key is
       the most useful thing left to show. The catalog test is what stops this ever happening. */
    if (template === undefined) return key;
    return interpolate(template, params, locale);
  };
}

/* English is present from the start; the others are filled in as they are asked for, so switching
   back to a language already used costs nothing. */
const LOADED = new Map<LocaleTag, Catalog>([['en', EN]]);

/** The catalog for a language, fetched once. */
export async function loadCatalog(locale: LocaleTag): Promise<Catalog> {
  const cached = LOADED.get(locale);
  if (cached !== undefined) return cached;

  const loaded: Catalog =
    locale === 'ca' ? (await import('./ca.json')).default : (await import('./es.json')).default;
  LOADED.set(locale, loaded);
  return loaded;
}
