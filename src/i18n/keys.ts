/**
 * What a message is, and what may be said.
 *
 * **The English catalog is the type.** `MessageKey` is derived from `en.json` rather than written
 * out beside it, so a key that does not exist is a compile error at the call site instead of a
 * blank space on somebody's screen. Adding a string to the app means adding it to `en.json` and
 * nowhere else.
 *
 * **A message is a reference, not a sentence.** `model/`, `gedcom/` and `storage/` may not import
 * React or the UI -- `eslint.config.js` enforces it -- and `history.ts` *stores* the label of every
 * edit in the undo stack. A module that produced English prose would either break that layering or
 * leave the undo stack half-translated after a language switch. So those layers produce a
 * `MessageRef` and the prose is rendered at the edge, by React, in whatever language is current.
 *
 * Plurals are a suffix on a shared base: `bar.people_one` and `bar.people_other` are two entries in
 * the catalog and one `MessageKey`, `bar.people`. The suffix set is CLDR's, so a locale needing
 * `few` and `many` adds them without the calling code changing.
 */
import en from './en.json';

/** CLDR's plural categories. `Intl.PluralRules` returns exactly these. */
export type PluralSuffix = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** Every literal entry in the catalog, plural variants included. */
export type CatalogKey = keyof typeof en;

type Simple<K extends string> = K extends `${string}_${PluralSuffix}` ? never : K;
type PluralBase<K extends string> = K extends `${infer B}_${PluralSuffix}` ? B : never;

/**
 * What a caller may ask for: every plain key, plus the base of every plural pair.
 *
 * `bar.people_one` is a catalog entry; `bar.people` is what the code asks for, and the count
 * decides which entry answers.
 */
export type MessageKey = Simple<CatalogKey> | PluralBase<CatalogKey>;

/** What gets substituted into `{placeholder}`s. `count` additionally selects the plural form. */
export type MessageParams = Readonly<Record<string, string | number>>;

/** A message named rather than written: what the pure layers hand upwards. */
export interface MessageRef {
  readonly key: MessageKey;
  readonly params?: MessageParams;
}

/** Render a message in the current language. Accepts a bare key or a whole reference. */
export type Translate = (key: MessageKey | MessageRef, params?: MessageParams) => string;

/**
 * A translation that may be incomplete: anything missing falls back to English.
 *
 * Keyed by plain `string` rather than by `CatalogKey`, because a language legitimately holds
 * entries English has not got: Catalan and Spanish both have a `many` plural form, used from a
 * million upwards where the noun takes `de`, and English has only `one` and `other`. The type that
 * has to be strict is `MessageKey` -- what the calling code may ask for -- not the bag of strings
 * a translator fills in.
 */
export type Catalog = Readonly<Record<string, string>>;

/** English, which is complete by construction -- it is the source the key type is derived from. */
export const EN: Catalog = en;

/**
 * Build a reference.
 *
 * A function rather than an object literal at each call site so that `exactOptionalPropertyTypes`
 * does not force every caller to spread-or-omit `params` by hand.
 */
export function ref(key: MessageKey, params?: MessageParams): MessageRef {
  return { key, ...(params === undefined ? {} : { params }) };
}
