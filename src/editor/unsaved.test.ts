/**
 * When closing the tab would cost something, and when it would not.
 *
 * This logic was inline in the shell and untested, which is exactly why it was wrong: the guard
 * fired on every session the moment a file opened, with no edits at all. Pulled out here it is
 * four cases and a truth table, and the case that used to fail is the first one below.
 *
 * Values are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { hasUnwrittenWork, keptSummary } from './unsaved.js';
import type { GedcomDoc } from '../model/types.js';
import { makeTranslate } from '../i18n/catalog.js';
import { EN } from '../i18n/keys.js';

/* These suites assert English prose. The catalog is asked for it explicitly rather than
   through a provider, so a change of default language never silently rewrites them. */
const say = makeTranslate('en', EN);

/** Two distinct documents. Only their identity matters -- the comparison is by reference. */
const opened: GedcomDoc = { header: { gedcomVersion: '7.0' }, individuals: [], families: [] };
const edited: GedcomDoc = { header: { gedcomVersion: '7.0' }, individuals: [], families: [] };

describe('with storage working', () => {
  const persistent = true;

  it('does not warn about a file just opened', () => {
    // The regression this file exists for. `exported` is the document that came off disk, so
    // nothing has changed -- and there was nothing to warn about even before that was true.
    expect(
      hasUnwrittenWork({ doc: opened, exported: opened, persistent, pending: false }),
    ).toBe(false);
  });

  it('warns while an edit has not reached the store', () => {
    // The only genuine window: between the edit and the autosave that follows it.
    expect(hasUnwrittenWork({ doc: edited, exported: opened, persistent, pending: true })).toBe(
      true,
    );
  });

  it('stops warning once the edit is stored, even though no file was written', () => {
    // Closing now loses nothing: the tree is in this browser and is offered again on the opening
    // screen. "You have not updated your .ged" is true, and is not an emergency.
    expect(
      hasUnwrittenWork({ doc: edited, exported: opened, persistent, pending: false }),
    ).toBe(false);
  });
});

describe('with storage unavailable', () => {
  const persistent = false;

  it('warns about anything not written out to a file', () => {
    // A private window, or site data switched off. The browser copy is not a copy.
    expect(hasUnwrittenWork({ doc: edited, exported: opened, persistent, pending: true })).toBe(
      true,
    );
  });

  it('does not warn when the document on screen is the one that was exported', () => {
    expect(hasUnwrittenWork({ doc: edited, exported: edited, persistent, pending: true })).toBe(
      false,
    );
  });

  it('does not warn about a file just opened here either', () => {
    expect(
      hasUnwrittenWork({ doc: opened, exported: opened, persistent, pending: false }),
    ).toBe(false);
  });
});

describe('with nothing open', () => {
  it('has nothing to lose', () => {
    expect(
      hasUnwrittenWork({ doc: undefined, exported: null, persistent: false, pending: true }),
    ).toBe(false);
  });
});

describe('undo', () => {
  it('stops counting as unwritten once it returns to the exported state', () => {
    // Documents are immutable and structurally shared, so returning to a past state returns the
    // same object -- which is what makes the reference comparison exact rather than approximate.
    const base = { doc: edited, exported: opened, persistent: false, pending: true };
    expect(hasUnwrittenWork(base)).toBe(true);
    expect(hasUnwrittenWork({ ...base, doc: opened })).toBe(false);
  });
});

describe('what the status line says', () => {
  it('admits when nothing is being kept at all', () => {
    expect(
      say(
        keptSummary({
          doc: opened,
          exported: null,
          persistent: false,
          pending: true,
          savedAt: null,
        }),
      ),
    ).toContain('lasts only as long as the tab');
  });

  it('says a write is in flight while one is', () => {
    expect(
      say(
        keptSummary({
          doc: edited,
          exported: null,
          persistent: true,
          pending: true,
          savedAt: '2026-08-26T02:30:00.000Z',
        }),
      ),
    ).toContain('Keeping');
  });

  it('says the tree is kept once it is', () => {
    expect(
      say(
        keptSummary({
          doc: edited,
          exported: null,
          persistent: true,
          pending: false,
          savedAt: '2026-08-26T02:30:00.000Z',
        }),
      ),
    ).toBe('Kept in this browser');
  });
});
