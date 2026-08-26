import { describe, expect, it } from 'vitest';

import {
  LOCALE_STORAGE_KEY,
  negotiate,
  openingLocale,
  rememberLocale,
  storedLocale,
} from './negotiate.js';

/** A `localStorage` that works, holding whatever it is seeded with. */
function working(seed: Record<string, string> = {}): Pick<Window, 'localStorage'> {
  const held = new Map(Object.entries(seed));
  return {
    localStorage: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => void held.set(key, value),
      removeItem: (key: string) => void held.delete(key),
      clear: () => {
        held.clear();
      },
      key: () => null,
      get length() {
        return held.size;
      },
    },
  };
}

/** A private window, where touching storage throws rather than returning nothing. */
const refusing: Pick<Window, 'localStorage'> = {
  localStorage: {
    getItem: () => {
      throw new Error('site data is switched off');
    },
    setItem: () => {
      throw new Error('site data is switched off');
    },
  } as unknown as Storage,
};

describe('negotiating from the browser preferences', () => {
  it('takes the first supported language, in the user own order', () => {
    expect(negotiate(['ca', 'es', 'en'])).toBe('ca');
    expect(negotiate(['es', 'ca'])).toBe('es');
  });

  it('matches on the base tag, so a region is not a near-miss', () => {
    expect(negotiate(['ca-ES'])).toBe('ca');
    expect(negotiate(['es-AR'])).toBe('es');
    expect(negotiate(['EN-GB'])).toBe('en');
  });

  it('skips languages this editor does not have', () => {
    expect(negotiate(['de', 'fr', 'ca'])).toBe('ca');
  });

  it('falls back to English rather than to nothing', () => {
    expect(negotiate(['de', 'fr'])).toBe('en');
    expect(negotiate([])).toBe('en');
  });
});

describe('the remembered choice', () => {
  it('is read back', () => {
    const scope = working({ [LOCALE_STORAGE_KEY]: 'ca' });
    expect(storedLocale(scope)).toBe('ca');
  });

  it('is written under a namespaced key', () => {
    const scope = working();
    rememberLocale('es', scope);
    expect(scope.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('es');
  });

  it('is ignored where it names a language that no longer exists', () => {
    expect(storedLocale(working({ [LOCALE_STORAGE_KEY]: 'de' }))).toBeUndefined();
  });

  it('is absent, not fatal, in a window that refuses storage', () => {
    expect(storedLocale(refusing)).toBeUndefined();
    expect(() => {
      rememberLocale('ca', refusing);
    }).not.toThrow();
  });
});

describe('what the app opens in', () => {
  const withLanguages = (
    scope: Pick<Window, 'localStorage'>,
    languages: readonly string[],
  ) => ({ ...scope, navigator: { languages } });

  it('prefers a choice the user made here over what the browser says', () => {
    const scope = withLanguages(working({ [LOCALE_STORAGE_KEY]: 'en' }), ['ca-ES', 'es']);
    expect(openingLocale(scope)).toBe('en');
  });

  it('uses the browser preference where nothing was chosen', () => {
    expect(openingLocale(withLanguages(working(), ['ca-ES', 'es']))).toBe('ca');
  });

  it('still opens where storage is refused entirely', () => {
    expect(openingLocale(withLanguages(refusing, ['es']))).toBe('es');
  });
});
