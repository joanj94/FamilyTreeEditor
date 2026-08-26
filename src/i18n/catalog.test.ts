import { describe, expect, it } from 'vitest';

import { LOCALES, makeTranslate, type LocaleTag } from './catalog.js';
import { pluralCategories } from './format.js';
import { EN, ref, type Catalog } from './keys.js';
import ca from './ca.json';
import es from './es.json';

const CATALOGS: Readonly<Record<LocaleTag, Catalog>> = { en: EN, ca, es };

const placeholdersOf = (template: string): readonly string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();

describe('translating', () => {
  const t = makeTranslate('en', EN);

  it('returns the entry for a plain key', () => {
    expect(t('bar.undo')).toBe('Undo');
  });

  it('substitutes placeholders', () => {
    expect(t('person.addChildTo', { xref: 'F1' })).toBe('Add a child to F1');
  });

  it('leaves a placeholder the params do not name, rather than a hole', () => {
    expect(t('person.addChildTo')).toBe('Add a child to {xref}');
  });

  it('accepts a whole reference, which is what the pure layers hand up', () => {
    expect(t(ref('command.rename', { name: 'GivenA' }))).toBe('Rename GivenA');
  });

  it('lets params passed alongside a reference win over the ones baked in', () => {
    expect(t(ref('command.rename', { name: 'GivenA' }), { name: 'GivenB' })).toBe(
      'Rename GivenB',
    );
  });
});

describe('plurals', () => {
  it('picks the singular for one and the plural for the rest, in English', () => {
    const t = makeTranslate('en', EN);
    expect(t('bar.people', { count: 1 })).toBe('1 person');
    expect(t('bar.people', { count: 4 })).toBe('4 people');
    expect(t('bar.people', { count: 0 })).toBe('0 people');
  });

  it('does the same in Catalan, through the locale own rules', () => {
    const t = makeTranslate('ca', ca);
    expect(t('bar.people', { count: 1 })).toBe('1 persona');
    expect(t('bar.people', { count: 4 })).toBe('4 persones');
  });

  it('formats the count the way the locale writes numbers', () => {
    /* Spanish and Catalan group with a dot, English with a comma. A count in a sentence is being
       read, not parsed, so it goes through Intl rather than String().

       Five digits rather than four on purpose: Spanish does not group a four-digit number at all
       (CLDR gives it `minimumGroupingDigits: 2`, so 1234 is written plain), which is exactly the
       sort of rule worth taking from the platform instead of hand-rolling. */
    expect(makeTranslate('es', es)('bar.people', { count: 12345 })).toContain('12.345');
    expect(makeTranslate('ca', ca)('bar.people', { count: 12345 })).toContain('12.345');
    expect(makeTranslate('en', EN)('bar.people', { count: 12345 })).toContain('12,345');
  });

  it('uses the form a language keeps for large numbers, where it has one', () => {
    /* Catalan and Spanish take `de` before the noun from a million upwards. English has no such
       form, and asking for one falls back to `other` rather than to nothing. */
    expect(makeTranslate('ca', ca)('bar.people', { count: 2000000 })).toBe(
      '2.000.000 de persones',
    );
    expect(makeTranslate('es', es)('bar.people', { count: 2000000 })).toBe(
      '2.000.000 de personas',
    );
    expect(makeTranslate('en', EN)('bar.people', { count: 2000000 })).toBe('2,000,000 people');
  });
});

describe('falling back', () => {
  it('shows the English sentence where a translation is missing, never the key', () => {
    const partial: Catalog = { 'bar.undo': 'Desfés' };
    const t = makeTranslate('ca', partial);
    expect(t('bar.undo')).toBe('Desfés');
    expect(t('bar.redo')).toBe('Redo');
  });

  it('falls back for a plural too', () => {
    const t = makeTranslate('ca', {});
    expect(t('bar.people', { count: 2 })).toBe('2 people');
  });
});

/**
 * Plural entries are compared per language rather than key-for-key against English.
 *
 * English has `one` and `other`; Catalan and Spanish also have `many`, which they use from a
 * million upwards, where the noun takes `de` -- "1.000.000 de persones". So a translation holding
 * keys English has not got is correct, and the thing worth asserting is that each language covers
 * its own categories and invents no base of its own.
 */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseOf = (key: string): string => key.replace(PLURAL, '');
const plainKeys = (catalog: Catalog): readonly string[] =>
  Object.keys(catalog)
    .filter((key) => !PLURAL.test(key))
    .sort();
const pluralBases = (catalog: Catalog): readonly string[] =>
  [
    ...new Set(
      Object.keys(catalog)
        .filter((key) => PLURAL.test(key))
        .map(baseOf),
    ),
  ].sort();

describe('the catalogs', () => {
  it.each(LOCALES)('%s has every plain key English has, and no others', (locale) => {
    expect(plainKeys(CATALOGS[locale])).toEqual(plainKeys(EN));
  });

  it.each(LOCALES)('%s pluralises exactly the messages English pluralises', (locale) => {
    expect(pluralBases(CATALOGS[locale])).toEqual(pluralBases(EN));
  });

  it.each(LOCALES)('%s covers every plural category the language actually has', (locale) => {
    const catalog = CATALOGS[locale];
    for (const base of pluralBases(EN)) {
      for (const category of pluralCategories(locale)) {
        expect({ base, category, present: `${base}_${category}` in catalog }).toEqual({
          base,
          category,
          present: true,
        });
      }
    }
  });

  it.each(LOCALES)('%s declares no plural form its language never selects', (locale) => {
    const allowed = new Set<string>(pluralCategories(locale));
    const stray = Object.keys(CATALOGS[locale])
      .filter((key) => PLURAL.test(key))
      .filter((key) => !allowed.has(PLURAL.exec(key)?.[1] ?? ''));
    expect(stray).toEqual([]);
  });

  it.each(LOCALES)('%s uses exactly the placeholders English uses', (locale) => {
    const catalog = CATALOGS[locale];
    for (const [key, translated] of Object.entries(catalog)) {
      /* A plural form English has not got is checked against English `other`, which is the entry
         it stands in for. */
      const english = EN[key] ?? EN[`${baseOf(key)}_other`];
      expect({ key, english: english === undefined }).toEqual({ key, english: false });
      expect({ key, placeholders: placeholdersOf(translated) }).toEqual({
        key,
        placeholders: placeholdersOf(english ?? ''),
      });
    }
  });
});
