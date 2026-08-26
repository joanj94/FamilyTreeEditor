// @vitest-environment jsdom
/**
 * Where the file goes, and what the user is told it did.
 *
 * Three questions, all of which have a wrong answer that looks fine on screen: does the save
 * dialog get used when the browser has one, does a name typed without an extension get one, and
 * does a cancelled dialog stay quiet. The last is the dangerous one -- the shell marks the
 * document written-back on this answer, and the unload guard reads that mark, so a cancellation
 * reported as a save is an afternoon's work lost to a closed tab.
 *
 * jsdom has neither the dialog nor the download machinery, so both are stood in for. Whether a
 * real browser then puts the bytes on a real disk is the browser's business.
 *
 * Values are structural placeholders. No real genealogy data enters this repository.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handOver, withExtension, type FileToHandOver } from './handOver.js';

const GEDCOM: FileToHandOver = {
  filename: 'invented.ged',
  text: '0 HEAD\n0 TRLR\n',
  mime: 'text/plain;charset=utf-8',
  kind: 'GEDCOM 7.0',
  extensions: ['.ged', '.gedcom'],
};

interface Chosen {
  options: unknown;
  readonly written: string[];
  closed: boolean;
}

/**
 * A window carrying a save dialog that accepts, under the given name.
 *
 * Built on the real window so the fallback path stays reachable and an anchor, if one is ever
 * made, lands in a real document.
 */
function windowWithDialog(
  name: string,
  onWrite?: () => never,
): { scope: Window; chosen: Chosen } {
  const chosen: Chosen = { options: null, written: [], closed: false };
  const dialog = (options: unknown): Promise<FileSystemFileHandle> => {
    chosen.options = options;
    return Promise.resolve({
      name,
      createWritable: () =>
        Promise.resolve({
          write: (chunk: string) => {
            if (onWrite !== undefined) onWrite();
            chosen.written.push(chunk);
            return Promise.resolve();
          },
          close: () => {
            chosen.closed = true;
            return Promise.resolve();
          },
        }),
    } as unknown as FileSystemFileHandle);
  };
  const scope = Object.create(window, {
    showSaveFilePicker: { value: dialog, configurable: true },
  }) as Window;
  return { scope, chosen };
}

/**
 * A window whose dialog throws whatever is handed in.
 *
 * Thrown rather than passed to `Promise.reject`, because what a browser raises here is a
 * `DOMException` and the lint rule that guards rejection reasons does not recognise one.
 */
const windowRefusing = (error: DOMException): Window =>
  Object.create(window, {
    showSaveFilePicker: {
      value: (): Promise<never> => {
        throw error;
      },
      configurable: true,
    },
  }) as Window;

/** Stand in for the download path jsdom does not implement. */
function stubDownloads(): { names: string[]; blobs: Blob[] } {
  const names: string[] = [];
  const blobs: Blob[] = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    blobs.push(blob as Blob);
    return 'blob:stub/0';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return { names, blobs };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('adding the extension', () => {
  it('adds the first one when a name carries none', () => {
    expect(withExtension('smith-family', ['.ged', '.gedcom'])).toBe('smith-family.ged');
    expect(withExtension('smith-family', ['.json'])).toBe('smith-family.json');
  });

  it('leaves any accepted extension the user chose deliberately', () => {
    expect(withExtension('smith.ged', ['.ged', '.gedcom'])).toBe('smith.ged');
    expect(withExtension('smith.gedcom', ['.ged', '.gedcom'])).toBe('smith.gedcom');
    expect(withExtension('smith.GED', ['.ged', '.gedcom'])).toBe('smith.GED');
  });

  it('adds one to a name ending in something else entirely', () => {
    // `family.2024` is a name, not an extension, and a GEDCOM file called that will not open.
    expect(withExtension('family.2024', ['.ged', '.gedcom'])).toBe('family.2024.ged');
  });
});

describe('when the browser has a save dialog', () => {
  it('opens it, and writes to what the user chose', async () => {
    const { scope, chosen } = windowWithDialog('smith-1890.ged');
    const result = await handOver(GEDCOM, scope);

    expect(result).toEqual({ outcome: 'saved', filename: 'smith-1890.ged' });
    expect(chosen.written).toEqual([GEDCOM.text]);
    expect(chosen.closed).toBe(true);
  });

  it('suggests the name and declares the extensions, so the dialog can append one', async () => {
    const { scope, chosen } = windowWithDialog('invented.ged');
    await handOver(GEDCOM, scope);

    expect(chosen.options).toMatchObject({
      suggestedName: 'invented.ged',
      // Bare: the API rejects a type carrying `;charset=utf-8`.
      types: [{ description: 'GEDCOM 7.0', accept: { 'text/plain': ['.ged', '.gedcom'] } }],
    });
  });

  it("reports the handle's own name, whatever the browser made of it", async () => {
    // The extension is the dialog's job here -- it is given the accepted list precisely so it can
    // append one. Correcting the name afterwards would only describe a file that does not exist.
    const { scope } = windowWithDialog('smith-family.gedcom');
    expect(await handOver(GEDCOM, scope)).toEqual({
      outcome: 'saved',
      filename: 'smith-family.gedcom',
    });
  });

  it('reports a closed dialog as a cancellation, never as a save', async () => {
    const cancelled = new DOMException('The user aborted a request.', 'AbortError');
    expect(await handOver(GEDCOM, windowRefusing(cancelled))).toEqual({ outcome: 'cancelled' });
  });

  it('reports a write that failed after a file was chosen', async () => {
    const { scope } = windowWithDialog('smith.ged', () => {
      throw new Error('the disk is full');
    });
    expect(await handOver(GEDCOM, scope)).toEqual({
      outcome: 'failed',
      problem: 'the disk is full',
    });
  });

  it('falls back to a download when the dialog itself will not open', async () => {
    // A sandboxed frame refuses the dialog. Nothing was chosen and nothing was lost, so the user
    // should get their file rather than an error about an API they have never heard of.
    const { names } = stubDownloads();
    const refused = new DOMException('Not allowed here', 'SecurityError');

    expect(await handOver(GEDCOM, windowRefusing(refused))).toEqual({
      outcome: 'saved',
      filename: 'invented.ged',
    });
    expect(names).toEqual(['invented.ged']);
  });
});

describe('when the browser has no save dialog', () => {
  it('hands the file over with a click, under a name carrying its extension', async () => {
    const { names, blobs } = stubDownloads();
    const result = await handOver({ ...GEDCOM, filename: 'smith-family' }, window);

    expect(result).toEqual({ outcome: 'saved', filename: 'smith-family.ged' });
    expect(names).toEqual(['smith-family.ged']);
    expect(await blobs[0]?.text()).toBe(GEDCOM.text);
  });

  it('leaves no anchor behind in the document', async () => {
    stubDownloads();
    await handOver(GEDCOM, window);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
