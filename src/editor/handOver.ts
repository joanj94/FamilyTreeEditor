/**
 * Handing the finished file to the user.
 *
 * Two ways exist, and the difference matters to the person doing it. A browser with the File
 * System Access API opens the operating system's own save dialog: the user chooses the folder and
 * the name, sees the file land where they meant it to, and can overwrite the `.ged` they opened
 * this morning. Without it, all a page can do is a blob and a synthetic click, which drops a file
 * into the downloads folder under a name the user never got to see. The dialog is the one worth
 * having, so it is tried first and the click is the fallback -- not the other way round.
 *
 * **The extension is this module's responsibility, not the user's.** A dialog asks for a name and
 * people type `smith-family`. A GEDCOM file called `smith-family` with no extension is one their
 * next program will refuse to open, and they will not know why. So the accepted extensions are
 * declared to the dialog, which is what makes a browser append one, and the fallback -- which has
 * no dialog to do it -- adds one itself with `withExtension`.
 *
 * What comes back is the handle's own name and not a corrected version of it. The browser decided
 * what the file is called; saying anything else would send the user looking for a file that does
 * not exist, which is the same failure as reporting a suggestion they had already renamed.
 *
 * **A cancelled dialog is not a save.** It is reported as such rather than as a success, because
 * the shell marks the document written-back on the strength of this answer, and the unload guard
 * reads that mark. Calling a cancelled save "saved" would silently disarm the one thing standing
 * between an afternoon's work and a closed tab.
 */

/** Everything needed to write one file and to describe it in a save dialog. */
export interface FileToHandOver {
  /** The name to suggest, extension included. */
  readonly filename: string;
  readonly text: string;
  readonly mime: string;
  /** What the dialog calls this kind of file. */
  readonly kind: string;
  /** Accepted extensions, dot included. The first is what a name without one gets. */
  readonly extensions: readonly string[];
}

export type HandOver =
  /** Written. The name is the one it really went to disk under, which the user may have changed. */
  | { readonly outcome: 'saved'; readonly filename: string }
  /** The user closed the dialog. Nothing was written and nothing should claim otherwise. */
  | { readonly outcome: 'cancelled' }
  /** A file was chosen and writing it failed. The user's disk did not get what they asked for. */
  | { readonly outcome: 'failed'; readonly problem: string };

interface SaveDialogType {
  readonly description: string;
  /** MIME type to the extensions it covers, as the API wants it. */
  readonly accept: Record<string, readonly string[]>;
}

interface SaveDialogOptions {
  readonly suggestedName: string;
  readonly types: readonly SaveDialogType[];
}

/**
 * `window.showSaveFilePicker`, which TypeScript's DOM library does not yet declare.
 *
 * Typed narrowly and read off the window rather than assumed: Firefox and Safari do not have it,
 * and neither does any browser on a page that is not a secure context.
 */
type SaveDialog = (options: SaveDialogOptions) => Promise<FileSystemFileHandle>;

const dialogOn = (scope: Window): SaveDialog | undefined =>
  (scope as Window & { showSaveFilePicker?: SaveDialog }).showSaveFilePicker;

/**
 * The user closing the dialog, which every implementation reports as an `AbortError`.
 *
 * Read off the object rather than through `instanceof Error`: what arrives is a `DOMException`,
 * and whether that inherits from `Error` differs between engines -- it does in V8, it does not in
 * jsdom. Mistaking a cancellation for a failure would tell somebody their file could not be
 * written when they were the one who decided not to write it.
 */
const nameOf = (error: unknown): string =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { name?: unknown }).name === 'string'
    ? (error as { name: string }).name
    : '';

const isCancellation = (error: unknown): boolean => nameOf(error) === 'AbortError';

const messageOf = (error: unknown): string =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : String(error);

/**
 * Give a name an extension it can be opened by, if it has not got one already.
 *
 * Any of the accepted extensions counts -- `.gedcom` is as valid as `.ged` and renaming somebody's
 * deliberate choice would be worse than leaving it. Only a name carrying none of them is added to.
 */
export function withExtension(name: string, extensions: readonly string[]): string {
  const lowered = name.toLowerCase();
  const carried = extensions.some((extension) => lowered.endsWith(extension.toLowerCase()));
  return carried ? name : `${name}${extensions[0] ?? ''}`;
}

/**
 * A blob and a synthetic click: the only file a page with no dialog available can give anybody.
 *
 * The URL is released on a timeout rather than immediately, because revoking it in the same tick
 * can cancel the download it was created for.
 */
function clickThrough(file: FileToHandOver, name: string, scope: Window): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
  const anchor = scope.document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  scope.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  scope.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * Ask the user where the file should go, then write it there.
 *
 * The dialog's `accept` map is keyed by a bare MIME type: the parameters that belong on a blob --
 * `;charset=utf-8` -- are rejected outright by the API, so they are stripped here rather than
 * left to throw at the one moment the user is watching.
 */
export async function handOver(
  file: FileToHandOver,
  scope: Window = window,
): Promise<HandOver> {
  const dialog = dialogOn(scope);

  if (dialog !== undefined) {
    let handle: FileSystemFileHandle | undefined;
    try {
      handle = await dialog({
        suggestedName: withExtension(file.filename, file.extensions),
        types: [
          {
            description: file.kind,
            accept: { [file.mime.split(';')[0] ?? file.mime]: [...file.extensions] },
          },
        ],
      });
    } catch (error) {
      if (isCancellation(error)) return { outcome: 'cancelled' };
      /* The dialog itself was refused -- a sandboxed frame, a browser that declares the method and
         will not open it. That is not the user's problem and not a lost file: fall through to the
         click, which works everywhere. Anything failing *after* a file is chosen is reported. */
      handle = undefined;
    }

    if (handle !== undefined) {
      try {
        const writable = await handle.createWritable();
        await writable.write(file.text);
        await writable.close();
      } catch (error) {
        return { outcome: 'failed', problem: messageOf(error) };
      }
      return { outcome: 'saved', filename: handle.name };
    }
  }

  const name = withExtension(file.filename, file.extensions);
  clickThrough(file, name, scope);
  return { outcome: 'saved', filename: name };
}
