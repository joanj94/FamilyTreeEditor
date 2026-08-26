/**
 * Turning a document into the file the user walks away with.
 *
 * Pure: it decides the name, the bytes and the words, and hands them back. The shell does the
 * handing over, because a blob and a synthetic click are the one part that needs a browser.
 *
 * The wording is the reason this is worth its own module and its own tests. What a user is told
 * after an export is the only account they get of what the format cost them -- nobody opens the
 * `.ged` in a text editor to check whether their `SEX X` survived. Getting "nothing left behind"
 * wrong in the reassuring direction is the most damaging sentence this application can print, so
 * it is derived from the notes the serializer actually returned rather than from the format.
 */
import { exportGedcom, exportJson, type ExportNote } from '../gedcom/serialize.js';
import type { GedcomDoc } from '../model/types.js';
import type { SaveFormat } from './Bar.js';

export interface Download {
  readonly filename: string;
  readonly text: string;
  readonly mime: string;
  /** What to tell the user, and what the format could not carry. */
  readonly headline: string;
  readonly notes: readonly ExportNote[];
}

/** The opened file's name without its extension, so a save keeps the family's name on it. */
export const stemOf = (name: string): string => name.replace(/\.(ged|gedcom|json)$/i, '');

/** Build the file and the account of it. */
export function prepareDownload(doc: GedcomDoc, name: string, format: SaveFormat): Download {
  const stem = stemOf(name);

  if (format === 'json') {
    return {
      filename: `${stem}.json`,
      text: exportJson(doc),
      mime: 'application/json',
      headline: `Saved ${stem}.json. The JSON is the document itself, so it carries everything.`,
      notes: [],
    };
  }

  const { text, notes } = exportGedcom(doc, { dialect: format });
  return {
    filename: `${stem}.ged`,
    text,
    mime: 'text/plain;charset=utf-8',
    headline:
      notes.length === 0
        ? `Saved ${stem}.ged as GEDCOM ${format}, with nothing left behind.`
        : `Saved ${stem}.ged as GEDCOM ${format}. That format could not carry ${String(notes.length)} of them:`,
    notes,
  };
}
