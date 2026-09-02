// @vitest-environment jsdom
/**
 * Sorting by birth, as the user reaches it.
 *
 * What the sort itself does is settled next door in `model/sort.test.ts`, over generated documents.
 * What is left here is the wiring, and every one of these is a way the button could be broken while
 * the model is perfect:
 *
 * **One press is one step.** The sort touches every family in the document, and an undo stack that
 * recorded a step per family would bury the edit before it under a hundred presses of Undo.
 *
 * **A press that changes nothing records nothing.** Otherwise the button quietly fills the history
 * with edits nobody made, and Undo stops meaning what it says.
 *
 * **The count of undated people reaches the screen.** It is the number that explains why part of a
 * chart did not move, and a user who is not told it will read the feature as broken.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './App.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

/** Open a file through the real input element, exactly as a user would. */
async function open(name: string, text: string): Promise<void> {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Expected a file input');

  const file = new File([text], name, { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });

  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await file.arrayBuffer();
  });
}

const buttonLabelled = (label: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label,
  );
  if (found === undefined) throw new Error(`No button reads ${JSON.stringify(label)}`);
  return found;
};

const press = (label: string): void => {
  act(() => {
    buttonLabelled(label).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/** What the notice band currently says about the last sort. */
const reported = (): string => container.querySelector('.sorted')?.textContent ?? '';

/** What Undo is currently offering to reverse, which is how a recorded step is observed. */
const wouldUndo = (): string => buttonLabelled('Undo').getAttribute('title') ?? '';

/**
 * Three siblings listed youngest first, one of them undated.
 *
 * The undated one is the point of the fixture rather than a garnish: a half-dated family is the
 * ordinary case in real genealogy, and it is what the reported count is about.
 */
const OUT_OF_ORDER = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME GivenA /SurnameB/',
  '1 BIRT',
  '2 DATE 1895',
  '1 FAMC @F1@',
  '0 @I2@ INDI',
  '1 NAME GivenC /SurnameB/',
  '1 BIRT',
  '2 DATE 1890',
  '1 FAMC @F1@',
  '0 @I3@ INDI',
  '1 NAME GivenD /SurnameB/',
  '1 FAMC @F1@',
  '0 @F1@ FAM',
  '1 CHIL @I1@',
  '1 CHIL @I2@',
  '1 CHIL @I3@',
  '0 TRLR',
  '',
].join('\n');

/**
 * The same three, already in order -- as records as well as as children.
 *
 * Both lists, because the sort puts both in order: the layout walks `doc.individuals` as well as
 * reading `FAM.CHIL`, so a file whose records are out of order is not one this has nothing to do
 * with, however tidy its CHIL lines look.
 */
const IN_ORDER = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I2@ INDI',
  '1 NAME GivenC /SurnameB/',
  '1 BIRT',
  '2 DATE 1890',
  '1 FAMC @F1@',
  '0 @I1@ INDI',
  '1 NAME GivenA /SurnameB/',
  '1 BIRT',
  '2 DATE 1895',
  '1 FAMC @F1@',
  '0 @I3@ INDI',
  '1 NAME GivenD /SurnameB/',
  '1 FAMC @F1@',
  '0 @F1@ FAM',
  '1 CHIL @I2@',
  '1 CHIL @I1@',
  '1 CHIL @I3@',
  '0 TRLR',
  '',
].join('\n');

/**
 * Two marriages of one person, recorded later one first.
 *
 * Every CHIL list here is already tidy -- there is only one child apiece -- so the only thing out
 * of order is the marriages. It is the shape this repository's own fixture turned out to have, and
 * the reason the report does not lead with a count of families.
 */
const MARRIAGES_OUT_OF_ORDER = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME GivenA /SurnameB/',
  '1 BIRT',
  '2 DATE 1870',
  '1 FAMS @F1@',
  '1 FAMS @F2@',
  '0 @F2@ FAM',
  '1 HUSB @I1@',
  '1 MARR',
  '2 DATE 1920',
  '0 @F1@ FAM',
  '1 HUSB @I1@',
  '1 MARR',
  '2 DATE 1900',
  '0 TRLR',
  '',
].join('\n');

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('sorting by birth', () => {
  it('offers nothing to sort until there is a tree', () => {
    expect(container.querySelector('.tidy')).toBeNull();
  });

  it('records the whole sort as one step a user can undo', async () => {
    await open('invented.ged', OUT_OF_ORDER);
    // Nothing to undo yet: the button carries a title only when it is enabled.
    expect(wouldUndo()).toBe('');

    press('Sort by birth');
    expect(wouldUndo()).toBe('Sort by birth date');

    // One step, so one Undo is back where the file started -- not one per family reordered.
    press('Undo');
    expect(wouldUndo()).toBe('');
  });

  it('says what it reordered, and how many people it could say nothing about', async () => {
    await open('invented.ged', OUT_OF_ORDER);
    press('Sort by birth');

    const said = reported();
    expect(said).toContain('1 family');
    // The undated person is not silently dropped to the end; the user is told there is one.
    expect(said).toContain('1 person has no birth date');
  });

  it('announces the report rather than merely drawing it', async () => {
    await open('invented.ged', OUT_OF_ORDER);
    press('Sort by birth');
    // The result of something the user just asked for: a status, which waits for a pause in
    // speech, rather than an alert that interrupts.
    expect(container.querySelector('.sorted')?.getAttribute('role')).toBe('status');
  });

  it('changes nothing, and records nothing, where the file is already in order', async () => {
    await open('invented.ged', IN_ORDER);
    press('Sort by birth');

    expect(reported()).toContain('Already in order');
    expect(wouldUndo()).toBe('');
  });

  it('is safe to press twice', async () => {
    await open('invented.ged', OUT_OF_ORDER);
    press('Sort by birth');
    press('Sort by birth');

    expect(reported()).toContain('Already in order');
    // Still one step: the second press found nothing to do and did not record one.
    press('Undo');
    expect(wouldUndo()).toBe('');
  });

  it('reports a real change even where no sibling list moved', async () => {
    await open('invented.ged', MARRIAGES_OUT_OF_ORDER);
    press('Sort by birth');

    // The marriages moved, so a step was recorded and the headline stands on its own -- rather
    // than a count of zero families, which would read as though nothing had happened.
    expect(wouldUndo()).toBe('Sort by birth date');
    expect(reported()).toContain('in the order they happened');
    expect(reported()).not.toContain('0 families');
  });

  it('drops the report as soon as it stops describing the document on screen', async () => {
    await open('invented.ged', OUT_OF_ORDER);
    press('Sort by birth');
    expect(reported()).not.toBe('');

    press('Undo');
    expect(reported()).toBe('');
  });
});
