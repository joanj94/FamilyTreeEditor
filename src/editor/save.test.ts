/**
 * What the user is told after an export.
 *
 * The only account anybody gets of what a format cost them: nobody opens the `.ged` afterwards to
 * check whether their `SEX X` survived. So "with nothing left behind" has to be earned by the
 * serializer returning no notes, not assumed from the format -- getting that wrong in the
 * reassuring direction is the most damaging sentence this application can print.
 *
 * Values are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { prepareDownload, stemOf } from './save.js';
import type { GedcomDoc } from '../model/types.js';

const doc = (over: Partial<GedcomDoc> = {}): GedcomDoc => ({
  header: { gedcomVersion: '7.0' },
  individuals: [],
  families: [],
  ...over,
});

/** A person GEDCOM 7 can describe and 5.5.1 cannot. */
const neither = doc({ individuals: [{ xref: '@I1@', sex: 'X' }] });

describe('naming the file', () => {
  it('keeps the name the family arrived under', () => {
    expect(prepareDownload(doc(), 'invented.ged', '7.0').filename).toBe('invented.ged');
    expect(prepareDownload(doc(), 'invented.ged', 'json').filename).toBe('invented.json');
  });

  it('replaces the extension rather than appending one', () => {
    expect(stemOf('invented.gedcom')).toBe('invented');
    expect(stemOf('invented.json')).toBe('invented');
    expect(stemOf('family.v2.ged')).toBe('family.v2');
  });

  it('leaves a name with no extension alone', () => {
    expect(prepareDownload(doc(), 'invented', '7.0').filename).toBe('invented.ged');
  });

  it('tells the save dialog which extensions belong to the format', () => {
    // Without this the dialog has nothing to append, and a user who types `smith-family` gets a
    // file their next program will not open.
    expect(prepareDownload(doc(), 'invented.ged', '7.0').extensions).toEqual([
      '.ged',
      '.gedcom',
    ]);
    expect(prepareDownload(doc(), 'invented.ged', '5.5.1').extensions).toEqual([
      '.ged',
      '.gedcom',
    ]);
    expect(prepareDownload(doc(), 'invented.ged', 'json').extensions).toEqual(['.json']);
  });

  it('names the kind of file, since that is what the dialog shows', () => {
    expect(prepareDownload(doc(), 'x.ged', '5.5.1').kind).toBe('GEDCOM 5.5.1');
    expect(prepareDownload(doc(), 'x.ged', 'json').kind).toContain('JSON');
  });
});

describe('what it says was saved', () => {
  it('claims nothing was left behind only when nothing was', () => {
    const written = prepareDownload(neither, 'invented.ged', '7.0');
    expect(written.notes).toEqual([]);
    expect(written.headline(written.filename)).toContain('nothing left behind');
  });

  it('names the file the user actually saved, not the one that was suggested', () => {
    // The save dialog lets them rename it. Reporting the suggestion sends them looking for a
    // file that does not exist.
    const written = prepareDownload(doc(), 'invented.ged', '7.0');
    expect(written.headline('smith-1890.ged')).toContain('Saved smith-1890.ged');
    expect(written.headline('smith-1890.ged')).not.toContain('invented');
  });

  it('counts what the older format could not carry, and hands the notes over', () => {
    const written = prepareDownload(neither, 'invented.ged', '5.5.1');
    expect(written.notes.length).toBeGreaterThan(0);
    expect(written.headline(written.filename)).toContain(
      `could not carry ${String(written.notes.length)}`,
    );
    expect(written.headline(written.filename)).not.toContain('nothing left behind');
    expect(written.notes.some((note) => note.message.includes('SEX value X'))).toBe(true);
  });

  it('says the JSON carries everything, because it does', () => {
    const written = prepareDownload(neither, 'invented.ged', 'json');
    expect(written.notes).toEqual([]);
    expect(written.headline(written.filename)).toContain('carries everything');
    expect(written.mime).toBe('application/json');
  });
});

describe('what it actually writes', () => {
  it('writes GEDCOM for a dialect and JSON for the document', () => {
    expect(prepareDownload(neither, 'x.ged', '7.0').text).toContain('1 SEX X');
    expect(prepareDownload(neither, 'x.ged', '5.5.1').text).toContain('1 SEX U');
    expect(JSON.parse(prepareDownload(neither, 'x.ged', 'json').text)).toMatchObject({
      individuals: [{ xref: '@I1@', sex: 'X' }],
    });
  });

  it('marks GEDCOM as text in the encoding it was written in', () => {
    expect(prepareDownload(doc(), 'x.ged', '7.0').mime).toBe('text/plain;charset=utf-8');
  });
});
