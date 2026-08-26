/**
 * Putting values into a message, and choosing which message a count wants.
 *
 * Both jobs are done by the platform. `Intl.PluralRules` knows that Catalan and English have two
 * forms and that other languages have up to six, and `Intl.NumberFormat` knows that a thousand is
 * written `1,000` in one place and `1.000` in another. Hand-rolling either would be inventing a
 * table the browser already ships, and getting it wrong quietly.
 *
 * **A missing placeholder is left visible.** Substituting nothing would produce a sentence with a
 * hole in it that reads as finished -- "Delete  and 2 links?" -- and nobody would report it. The
 * `{name}` stays put instead, which is obviously broken and therefore gets fixed.
 */
import type { MessageParams, PluralSuffix } from './keys.js';

/* `Intl.PluralRules` and `Intl.NumberFormat` are not cheap to construct and the chart rebuilds
   its labels on every render, so one of each per locale is kept rather than one per call. */
const PLURALS = new Map<string, Intl.PluralRules>();
const NUMBERS = new Map<string, Intl.NumberFormat>();

function pluralRules(locale: string): Intl.PluralRules {
  const existing = PLURALS.get(locale);
  if (existing !== undefined) return existing;
  const made = new Intl.PluralRules(locale);
  PLURALS.set(locale, made);
  return made;
}

function numberFormat(locale: string): Intl.NumberFormat {
  const existing = NUMBERS.get(locale);
  if (existing !== undefined) return existing;
  const made = new Intl.NumberFormat(locale);
  NUMBERS.set(locale, made);
  return made;
}

/** Which plural form this locale wants for this count. */
export function pluralCategory(locale: string, count: number): PluralSuffix {
  return pluralRules(locale).select(count);
}

/** The plural categories this locale actually uses, for the catalog completeness test. */
export function pluralCategories(locale: string): readonly PluralSuffix[] {
  return pluralRules(locale).resolvedOptions().pluralCategories;
}

/** A number as this locale writes it. */
export function formatNumber(locale: string, value: number): string {
  return numberFormat(locale).format(value);
}

/**
 * Substitute `{placeholder}`s.
 *
 * Numbers go through `Intl.NumberFormat`, because a count that appears in a sentence is being read
 * rather than parsed. Anything the params do not name is left exactly as it was written.
 */
export function interpolate(
  template: string,
  params: MessageParams | undefined,
  locale: string,
): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? formatNumber(locale, value) : value;
  });
}
