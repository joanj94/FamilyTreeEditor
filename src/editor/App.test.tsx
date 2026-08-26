// @vitest-environment jsdom
/**
 * Saving, as the user reaches it.
 *
 * The serializer is tested thoroughly next door. What is left, and what no amount of testing
 * `exportGedcom` would catch, is the wiring: that a button produces a file at all, that the file
 * is named after the one the user opened, and that a format's losses reach the screen instead of
 * a console nobody reads. A save is the moment somebody's own file is replaced, so a silent
 * failure here is the most expensive kind this project has.
 *
 * jsdom has neither a save dialog nor any download machinery, so `createObjectURL` is stubbed and
 * the anchor's click is intercepted -- which is also the path a browser without the File System
 * Access API takes. The dialog is stood in for where it is the thing under test. Whether a real
 * browser then writes the file to disk is the browser's business.
 *
 * Saving is asynchronous now that a dialog can sit in the middle of it, so every press of a save
 * button is followed by `settle()`. Without it the assertions run before the file exists.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

interface Handed {
  readonly name: string;
  readonly type: string;
  readonly blob: Blob;
}

let container: HTMLDivElement;
let root: Root;
let handed: Handed[];

/** Stand in for the parts of the download path jsdom does not implement. */
function stubDownloads(): void {
  handed = [];
  const blobs = new Map<string, Blob>();

  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    const url = `blob:stub/${String(blobs.size)}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);
    if (blob === undefined) throw new Error(`No blob was made for ${this.href}`);
    handed.push({ name: this.download, type: blob.type, blob });
  });
}

/** The text of the nth file handed over. Read after the click, so nothing races the render. */
const textOf = async (index: number): Promise<string> => {
  const entry = handed[index];
  if (entry === undefined)
    throw new Error(`Only ${String(handed.length)} files were handed over`);
  return entry.blob.text();
};

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

/** Let the hand-over promise resolve and React re-render on the back of it. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

/**
 * Fit the window with a save dialog that answers with `name`, and collect what it is given.
 *
 * jsdom has none, so without this the tests only ever exercise the fallback.
 */
function stubDialog(name: string | null): { written: { name: string; text: string }[] } {
  const written: { name: string; text: string }[] = [];
  const dialog = (): Promise<FileSystemFileHandle> => {
    if (name === null) {
      return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    }
    return Promise.resolve({
      name,
      createWritable: () =>
        Promise.resolve({
          write: (text: string) => {
            written.push({ name, text });
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        }),
    } as unknown as FileSystemFileHandle);
  };
  Object.defineProperty(window, 'showSaveFilePicker', { value: dialog, configurable: true });
  return { written };
}

/** Click a person in the chart, which is how the record panel is reached. */
const choose = (xref: string): void => {
  const node = container.querySelector(`[data-id="${xref}"]`);
  if (node === null) throw new Error(`No node is drawn for ${xref}`);
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
  });
};

const SOURCE = [
  '0 HEAD',
  '1 GEDC',
  '2 VERS 7.0',
  '0 @I1@ INDI',
  '1 NAME GivenA /SurnameB/',
  '1 SEX X',
  '1 _VENDOR Something this editor has never heard of',
  '0 TRLR',
  '',
].join('\n');

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  stubDownloads();

  act(() => {
    root.render(<App />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  // Nothing in jsdom owns this, so a stub left behind would follow the next test in.
  delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  vi.restoreAllMocks();
});

describe('saving', () => {
  it('offers nothing to save until there is a tree', () => {
    // The opening screen's own button is not a save, so this asks about the saves specifically
    // rather than about there being no buttons at all.
    const labels = [...container.querySelectorAll('button')].map(
      (button) => button.textContent,
    );
    expect(labels.filter((label) => label?.startsWith('Save'))).toEqual([]);
    expect(container.querySelector('.saves')).toBeNull();
  });

  it('hands over a GEDCOM 7 file named after the one that was opened', async () => {
    await open('invented.ged', SOURCE);
    press('Save GEDCOM 7');
    await settle();

    expect(handed).toHaveLength(1);
    expect(handed[0]?.name).toBe('invented.ged');
    expect(handed[0]?.type).toContain('text/plain');

    const written = await textOf(0);
    expect(written.startsWith('0 HEAD\n')).toBe(true);
    expect(written).toContain('1 SEX X');
    // The tag nobody modelled is in the file the user gets back.
    expect(written).toContain('1 _VENDOR Something this editor has never heard of');
    expect(written.endsWith('0 TRLR\n')).toBe(true);
  });

  it('says plainly when nothing was left behind', async () => {
    await open('invented.ged', SOURCE);
    press('Save GEDCOM 7');
    await settle();
    expect(container.querySelector('.saved')?.textContent).toContain('nothing left behind');
    expect(container.querySelectorAll('.saved li')).toHaveLength(0);
  });

  it('names what the older format could not carry, rather than losing it quietly', async () => {
    // 5.5.1 has no SEX value X. The substitution is legitimate and the user is told about it,
    // because it changes what the record asserts about a person.
    await open('invented.ged', SOURCE);
    press('Save 5.5.1');
    await settle();

    expect(await textOf(0)).toContain('1 SEX U');

    const reported = [...container.querySelectorAll('.saved li')].map(
      (item) => item.textContent,
    );
    expect(reported.some((note) => note?.includes('SEX value X'))).toBe(true);
  });

  it('hands over the document as JSON when asked', async () => {
    await open('invented.ged', SOURCE);
    press('Save JSON');
    await settle();

    expect(handed[0]?.name).toBe('invented.json');
    expect(handed[0]?.type).toBe('application/json');
    const parsed: unknown = JSON.parse(await textOf(0));
    expect(parsed).toMatchObject({ individuals: [{ xref: '@I1@', sex: 'X' }] });
  });

  it('withdraws the report once the document has moved on', async () => {
    // A report describing a document the user has since changed is worse than no report: it says
    // a file was saved that no longer matches what is on the screen.
    await open('invented.ged', SOURCE);
    press('Save GEDCOM 7');
    await settle();
    expect(container.querySelector('.saved')).not.toBeNull();

    choose('@I1@');
    press('Add a partner');
    expect(container.querySelector('.saved')).toBeNull();
  });

  it('withdraws it on undo too, which moves the document just as surely', async () => {
    await open('invented.ged', SOURCE);
    choose('@I1@');
    press('Add a partner');
    press('Save GEDCOM 7');
    await settle();
    expect(container.querySelector('.saved')).not.toBeNull();

    press('Undo');
    expect(container.querySelector('.saved')).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Beginning with no file.
 *
 * Everything else in this shell starts with somebody's `.ged`. A person recording what they know
 * has nothing to open, and for them the opening screen was a door with no handle. What matters
 * here is not that a button exists but that what it produces can be worked on: a record to click,
 * a panel to type into, and a file at the end of it.
 * ------------------------------------------------------------------------------------------- */
describe('starting from scratch', () => {
  it('offers the way in before anything is open', () => {
    expect(buttonLabelled('Start a new tree')).not.toBeNull();
  });

  it('draws a tree with one person in it', () => {
    press('Start a new tree');
    expect(container.querySelectorAll('[data-id]')).toHaveLength(1);
  });

  it('opens the record panel on that person, since it is where a tree is built', () => {
    // An unnamed box on an otherwise empty chart is not an obvious invitation to click.
    press('Start a new tree');
    const panel = container.querySelector('.record');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);
  });

  it('can be built on straight away', () => {
    press('Start a new tree');
    press('Add a partner');
    expect(container.querySelectorAll('[data-id]').length).toBeGreaterThan(1);
    expect(container.querySelector('.refused')).toBeNull();
  });

  it('hands over a real file, named so the user can rename it', async () => {
    press('Start a new tree');
    press('Save GEDCOM 7');
    await settle();

    expect(handed[0]?.name).toBe('untitled.ged');
    const written = await textOf(0);
    expect(written.startsWith('0 HEAD\n')).toBe(true);
    expect(written).toContain('0 @I1@ INDI');
    expect(written.endsWith('0 TRLR\n')).toBe(true);
  });

  it('says the tree has never been written to a file', () => {
    // It has not. Where this browser stores nothing, that is the difference between a tree and
    // a closed tab.
    press('Start a new tree');
    expect(container.querySelector('.kept')?.textContent).toContain('not yet written back');
  });
});

/* ------------------------------------------------------------------------------------------- *
 * The save dialog.
 *
 * Where the browser has one, the user picks the folder and the name -- which means they can
 * overwrite the `.ged` they opened this morning, and that they can also close the dialog without
 * saving anything. Both of those change what the shell may claim afterwards.
 * ------------------------------------------------------------------------------------------- */
describe('choosing where the file goes', () => {
  it('writes through the dialog rather than dropping a download', async () => {
    const dialog = stubDialog('smith-1890.ged');
    await open('invented.ged', SOURCE);
    press('Save GEDCOM 7');
    await settle();

    expect(dialog.written).toHaveLength(1);
    expect(dialog.written[0]?.text).toContain('1 SEX X');
    // The fallback path stayed shut: no blob, no synthetic click.
    expect(handed).toHaveLength(0);
  });

  it('reports the name the user chose, not the one that was suggested', async () => {
    stubDialog('smith-1890.ged');
    await open('invented.ged', SOURCE);
    press('Save GEDCOM 7');
    await settle();

    const said = container.querySelector('.saved')?.textContent;
    expect(said).toContain('smith-1890.ged');
    expect(said).not.toContain('invented.ged');
  });

  it('says nothing at all when the dialog is closed without saving', async () => {
    // The report is the smaller half. Marking the document written-back would disarm the unload
    // guard over a file that was never created.
    stubDialog(null);
    await open('invented.ged', SOURCE);
    choose('@I1@');
    press('Add a partner');
    press('Save GEDCOM 7');
    await settle();

    expect(container.querySelector('.saved')).toBeNull();
    expect(container.querySelector('.kept')?.textContent).toContain('not yet written back');
  });

  it('counts a completed save as written back', async () => {
    stubDialog('invented.ged');
    await open('invented.ged', SOURCE);
    choose('@I1@');
    press('Add a partner');
    expect(container.querySelector('.kept')?.textContent).toContain('not yet written back');

    press('Save GEDCOM 7');
    await settle();
    expect(container.querySelector('.kept')?.textContent).not.toContain('not yet written back');
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Being told what happened.
 *
 * Every one of these messages appears in response to something the user just did and then sits
 * there silently. For anybody using a screen reader that is the same experience as an export that
 * lost data quietly: the words are on the page, and nothing says them.
 * ------------------------------------------------------------------------------------------- */
describe('announcements', () => {
  it('announces what an export could not carry', async () => {
    await open('invented.ged', SOURCE);
    press('Save 5.5.1');
    await settle();

    const region = container.querySelector('.saved');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.textContent).toContain('SEX value X');
  });

  it('announces a save that lost nothing, so silence never means success', async () => {
    await open('invented.ged', SOURCE);
    press('Save GEDCOM 7');
    await settle();
    expect(container.querySelector('.saved')?.getAttribute('role')).toBe('status');
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Where focus goes.
 *
 * Found in a real browser, not here: opening a record from the chart left focus on the node, and
 * the panel is rendered after the entire scene -- so reaching the fields you had just opened meant
 * tabbing past every remaining person, union and fold control. Thirty-one stops on an
 * eighteen-person file; several hundred on a real chart, which is not a keyboard route at all.
 * ------------------------------------------------------------------------------------------- */
describe('focus follows the selection', () => {
  it('moves into the record panel when one opens', async () => {
    await open('invented.ged', SOURCE);
    choose('@I1@');

    const panel = container.querySelector('.record');
    expect(panel).not.toBeNull();
    expect(document.activeElement).toBe(panel);
  });

  it('gives the panel a name, since focus lands on the container', async () => {
    await open('invented.ged', SOURCE);
    choose('@I1@');
    expect(container.querySelector('.record')?.getAttribute('aria-label')).toBe('Record');
  });

  it('keeps the panel out of the tab order itself', async () => {
    // -1, not 0: focus is *put* there, and Tab from it should reach the first field rather than
    // stopping on the container a second time.
    await open('invented.ged', SOURCE);
    choose('@I1@');
    expect(container.querySelector('.record')?.getAttribute('tabindex')).toBe('-1');
  });

  it('returns focus to the node it came from when Escape closes the panel', async () => {
    await open('invented.ged', SOURCE);
    choose('@I1@');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container.querySelector('.record')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[data-id="@I1@"]'));
  });

  it('ignores Escape when no record is open', async () => {
    await open('invented.ged', SOURCE);
    expect(() => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
    }).not.toThrow();
  });
});
