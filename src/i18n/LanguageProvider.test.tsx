// @vitest-environment jsdom
/**
 * The provider, and the two things a language switch has to move together.
 *
 * The strings are the obvious half. `document.documentElement.lang` is the half that gets
 * forgotten, and forgetting it is not cosmetic: a screen reader picks its voice and its
 * pronunciation rules from that attribute, so Catalan left under `lang="en"` is read aloud with
 * English phonemes. A test that only checked the visible text would pass while that was broken.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LanguageProvider } from './LanguageProvider.js';
import { useLanguage } from './context.js';
import { loadCatalog, type LocaleTag } from './catalog.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** Says one pluralised string, and offers a way to change language from inside the tree. */
function Probe() {
  const { t, locale, setLocale } = useLanguage();
  return (
    <>
      <p className="said">{t('bar.people', { count: 2 })}</p>
      <p className="locale">{locale}</p>
      <button
        type="button"
        onClick={() => {
          setLocale('ca');
        }}
      >
        {t('bar.undo')}
      </button>
    </>
  );
}

/*
 * The catalogs for `ca` and `es` arrive through a dynamic import, so the fetch is completed before
 * rendering rather than raced against it. `loadCatalog` caches, so the provider's own call then
 * resolves from memory and one flush is enough to see the result. Awaiting a bare microtask was
 * not: it returns long before a dynamic import has resolved, and the assertion read English.
 */
const mount = async (locale?: LocaleTag): Promise<void> => {
  if (locale !== undefined) await loadCatalog(locale);
  await act(async () => {
    root.render(
      locale === undefined ? (
        <LanguageProvider>
          <Probe />
        </LanguageProvider>
      ) : (
        <LanguageProvider locale={locale}>
          <Probe />
        </LanguageProvider>
      ),
    );
    await Promise.resolve();
  });
};

const said = (): string => container.querySelector('.said')?.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  document.documentElement.lang = 'en';
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('rendering in a chosen language', () => {
  it('says English when English is chosen', async () => {
    await mount('en');
    expect(said()).toBe('2 people');
  });

  it('says Catalan when Catalan is chosen', async () => {
    await mount('ca');
    expect(said()).toBe('2 persones');
  });

  it('says Spanish when Spanish is chosen', async () => {
    await mount('es');
    expect(said()).toBe('2 personas');
  });
});

describe('what a switch moves', () => {
  it('changes the strings and the document language together', async () => {
    await mount('en');
    expect(document.documentElement.lang).toBe('en');

    await mount('ca');
    expect(said()).toBe('2 persones');
    expect(document.documentElement.lang).toBe('ca');
  });

  it('lets a component inside the tree change the language', async () => {
    await mount();
    const button = container.querySelector('button');
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(container.querySelector('.locale')?.textContent).toBe('ca');
    expect(said()).toBe('2 persones');
  });
});

describe('before a catalog has arrived', () => {
  it('shows English rather than a raw key', () => {
    /* The dynamic import has not resolved on the first paint. English answering in the meantime
       is the point: a button reading "Undo" for a moment beats one reading `bar.undo`. */
    act(() => {
      root.render(
        <LanguageProvider locale="ca">
          <Probe />
        </LanguageProvider>,
      );
    });
    expect(said()).not.toContain('bar.people');
    expect(said()).toBe('2 people');
  });
});
