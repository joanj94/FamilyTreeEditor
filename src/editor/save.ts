/**
 * Turning a document into the file the user walks away with.
 *
 * Pure: it decides the name, the bytes and the words, and hands them back. `handOver.ts` does the
 * handing over, because a save dialog and a synthetic click are the one part that needs a browser.
 *
 * The wording is the reason this is worth its own module and its own tests. What a user is told
 * after an export is the only account they get of what the format cost them -- nobody opens the
 * `.ged` in a text editor to check whether their `SEX X` survived. Getting "nothing left behind"
 * wrong in the reassuring direction is the most damaging sentence this application can print, so
 * it is derived from the notes the serializer actually returned rather than from the format.
 *
 * `headline` is a function of the name rather than a finished sentence for the same reason. The
 * save dialog lets the user rename the file, so the name this module suggests and the name on
 * their disk need not match. Telling somebody "Saved invented.ged" about a file they just called
 * `smith-1890.ged` sends them looking for a file that does not exist.
 */
import { exportGedcom, exportJson, type ExportNote } from '../gedcom/serialize.js';
import { ref, type MessageRef } from '../i18n/keys.js';
import type { GedcomDoc } from '../model/types.js';
import type { SaveFormat } from './Bar.js';

export interface Download {
  /** The name to suggest in the save dialog, extension included. */
  readonly filename: string;
  readonly text: string;
  readonly mime: string;
  /**
   * What the save dialog calls this kind of file.
   *
   * Named rather than written because it is read by the user in the operating system's own
   * dialog, which is the last place an application should suddenly revert to English. `handOver`
   * still takes a plain string: rendering happens at the boundary, so the file-writing code needs
   * to know nothing about languages.
   */
  readonly kind: MessageRef;
  /** Extensions the dialog accepts, dot included. The first is the one a bare name gets. */
  readonly extensions: readonly string[];
  /** What to tell the user, given the name the file really went to disk under. */
  readonly headline: (savedAs: string) => MessageRef;
  readonly notes: readonly ExportNote[];
}

/** The opened file's name without its extension, so a save keeps the family's name on it. */
export const stemOf = (name: string): string => name.replace(/\.(ged|gedcom|json)$/i, '');

/**
 * Both spellings, oldest-first.
 *
 * `.ged` leads because it is what a name typed without one should become; `.gedcom` is accepted
 * so that a user who deliberately typed it keeps it -- see `withExtension`.
 */
const GEDCOM_EXTENSIONS = ['.ged', '.gedcom'] as const;

/** Build the file and the account of it. */
export function prepareDownload(doc: GedcomDoc, name: string, format: SaveFormat): Download {
  const stem = stemOf(name);

  if (format === 'json') {
    return {
      filename: `${stem}.json`,
      text: exportJson(doc),
      mime: 'application/json',
      kind: ref('save.jsonKind'),
      extensions: ['.json'],
      headline: (savedAs) => ref('save.jsonHeadline', { savedAs }),
      notes: [],
    };
  }

  const { text, notes } = exportGedcom(doc, { dialect: format });
  return {
    filename: `${stem}.ged`,
    text,
    mime: 'text/plain;charset=utf-8',
    kind: ref('save.gedcomKind', { format }),
    extensions: [...GEDCOM_EXTENSIONS],
    headline: (savedAs) =>
      notes.length === 0
        ? ref('save.gedcomClean', { savedAs, format })
        : ref('save.gedcomNotes', { savedAs, format, count: notes.length }),
    notes,
  };
}
