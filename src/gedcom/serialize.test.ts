/**
 * The decisions the serializer makes, one at a time.
 *
 * `tests/roundtrip.test.ts` asserts the property -- that a document survives being written and
 * read back. This file asserts the judgements underneath it: what happens to a `SEX X` bound for
 * 5.5.1, what is written where the document and the target dialect disagree, and which of those
 * are reported rather than done quietly. A round trip can be perfect while the file it produced
 * lies about its own encoding, so those cases need naming individually.
 *
 * Every fixture is written for the case it tests. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { importGedcom } from './mapper.js';
import { exportGedcom, exportJson, toRecords } from './serialize.js';
import { validateDoc } from '../model/validate.js';
import type { GedcomDoc } from '../model/types.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const empty: GedcomDoc = { header: { gedcomVersion: '7.0' }, individuals: [], families: [] };

const doc = (over: Partial<GedcomDoc>): GedcomDoc => ({ ...empty, ...over });

const lines = (text: string): readonly string[] => text.split('\n').slice(0, -1);

const written = (source: GedcomDoc, dialect: '7.0' | '5.5.1' = '7.0'): readonly string[] =>
  lines(exportGedcom(source, { dialect }).text);

const notesOf = (source: GedcomDoc, dialect: '7.0' | '5.5.1' = '7.0'): readonly string[] =>
  exportGedcom(source, { dialect }).notes.map((note) => note.message);

/** Import text and export it again, which is the shape most of these tests want. */
const through = (text: string, dialect: '7.0' | '5.5.1') =>
  exportGedcom(importGedcom(bytes(text)).doc, { dialect });

describe('the header', () => {
  it('declares the version, which is all GEDCOM 7 requires of it', () => {
    expect(written(empty)).toEqual(['0 HEAD', '1 GEDC', '2 VERS 7.0', '0 TRLR']);
  });

  it('keeps a more precise version rather than rounding it to the dialect', () => {
    // A file declaring 7.0.14 is declaring something true. Replacing it with 7.0 would make a
    // round trip lossy over the one field whose whole job is to say what the file is.
    const source = doc({ header: { gedcomVersion: '7.0.14' } });
    expect(written(source)).toContain('2 VERS 7.0.14');
    expect(notesOf(source)).toEqual([]);
  });

  it('writes the dialect asked for when the document declares another, and says so', () => {
    const source = doc({ header: { gedcomVersion: '5.5.1' } });
    expect(written(source)).toContain('2 VERS 7.0');
    expect(notesOf(source)).toEqual([
      'The header declared GEDCOM 5.5.1; 7.0 was written instead.',
    ]);
  });

  it('writes the source system with its name and version beneath it', () => {
    const source = doc({
      header: {
        gedcomVersion: '7.0',
        sourceSystem: 'PlaceholderApp',
        sourceName: 'Placeholder Genealogy',
        sourceVersion: '1.2.3',
      },
    });
    expect(written(source)).toEqual([
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '1 SOUR PlaceholderApp',
      '2 VERS 1.2.3',
      '2 NAME Placeholder Genealogy',
      '0 TRLR',
    ]);
  });

  it('adds what 5.5.1 requires and 7 has no place for', () => {
    const written551 = written(empty, '5.5.1');
    expect(written551).toContain('2 FORM LINEAGE-LINKED');
    expect(written551).toContain('1 CHAR UTF-8');
    expect(written(empty)).not.toContain('2 FORM LINEAGE-LINKED');
  });

  it('says that 5.5.1 wanted a submitter rather than inventing one', () => {
    // A fabricated SUBM record would be a person this file claims exists. Reporting the gap keeps
    // the output honest and keeps the round trip exact.
    expect(notesOf(empty, '5.5.1')).toContain(
      'GEDCOM 5.5.1 requires HEAD.SUBM and this document has no submitter. None was invented.',
    );
    expect(written(empty, '5.5.1').some((line) => line.startsWith('1 SUBM'))).toBe(false);
  });
});

describe('the charset declaration', () => {
  // HEAD.CHAR describes the bytes, and this module is what produces them. Copying an inherited
  // declaration onto different bytes is how a file full of accented names comes back as mojibake.
  const declaring = (charset: string): string =>
    `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR ${charset}\n0 TRLR\n`;

  it('is dropped for GEDCOM 7, which removed the tag', () => {
    const result = through(declaring('UTF-8'), '7.0');
    expect(lines(result.text).some((line) => line.startsWith('1 CHAR'))).toBe(false);
    expect(result.notes.map((note) => note.message)).toContain(
      'GEDCOM 7 removed HEAD.CHAR; the declaration was dropped and the file is UTF-8.',
    );
  });

  it('is rewritten to what the bytes actually are, for 5.5.1', () => {
    const result = through(declaring('ANSEL'), '5.5.1');
    expect(lines(result.text)).toContain('1 CHAR UTF-8');
    expect(lines(result.text).some((line) => line.includes('ANSEL'))).toBe(false);
    expect(result.notes.map((note) => note.observed)).toContain('ANSEL');
  });

  it('is left in peace when it already tells the truth', () => {
    const notes = through(declaring('UTF-8'), '5.5.1').notes;
    expect(notes.some((note) => note.message.includes('CHAR'))).toBe(false);
  });

  it('carries an ANSEL file out as UTF-8 with its accents intact', () => {
    // The round trip this project exists to protect. ANSEL puts the diacritic before the letter
    // it sits on, so a declaration copied onto re-encoded bytes corrupts a name in the file the
    // user gets back -- and they have no way to notice until the original is gone.
    const head = bytes('0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME Ren');
    // 0xE2 is ANSEL's combining acute, and it precedes the `e` it belongs to.
    const accented = Uint8Array.from([0xe2, 0x65]);
    const tail = bytes('e /Placeholder/\n0 TRLR\n');
    const source = new Uint8Array([...head, ...accented, ...tail]);

    const first = importGedcom(source);
    expect(first.doc.origin?.encoding).toBe('ANSEL');
    const name = first.doc.individuals[0]?.names?.[0]?.value;
    expect(name).toBe('Renée /Placeholder/');

    const exported = exportGedcom(first.doc, { dialect: '5.5.1' });
    expect(lines(exported.text)).toContain('1 CHAR UTF-8');

    const reread = importGedcom(bytes(exported.text));
    expect(reread.doc.origin?.encoding).toBe('UTF-8');
    expect(reread.doc.individuals[0]?.names?.[0]?.value).toBe(name);
  });
});

describe('sex', () => {
  const person = (sex: 'M' | 'X'): GedcomDoc => doc({ individuals: [{ xref: '@I1@', sex }] });

  it('writes X unchanged in GEDCOM 7, which defined it', () => {
    expect(written(person('X'))).toContain('1 SEX X');
    expect(notesOf(person('X'))).toEqual([]);
  });

  it('writes U in 5.5.1, and says that the record now says less', () => {
    // U means undetermined, which is a different statement from "neither male nor female". The
    // substitution is made because 5.5.1 defines no other value, and reported because it changes
    // what the record asserts about a person.
    expect(written(person('X'), '5.5.1')).toContain('1 SEX U');
    expect(notesOf(person('X'), '5.5.1')).toContain(
      'GEDCOM 5.5.1 has no SEX value X; U was written, which says less.',
    );
  });

  it('leaves every other value alone in both dialects', () => {
    expect(written(person('M'), '5.5.1')).toContain('1 SEX M');
    expect(notesOf(person('M'), '5.5.1').some((note) => note.includes('SEX'))).toBe(false);
  });
});

describe('dates', () => {
  const withDate = (value: string, phrase?: string): GedcomDoc =>
    doc({
      individuals: [
        {
          xref: '@I1@',
          events: [
            { tag: 'BIRT', date: { value, ...(phrase === undefined ? {} : { phrase }) } },
          ],
        },
      ],
    });

  it('writes the payload exactly as the file wrote it', () => {
    // `value` is authoritative, so a date this tool could not parse leaves as it arrived rather
    // than being normalised into a precision the source never claimed.
    expect(written(withDate('ABT 1801'))).toContain('2 DATE ABT 1801');
    expect(written(withDate('sometime after the war'))).toContain(
      '2 DATE sometime after the war',
    );
  });

  it('writes a phrase as a substructure in 7', () => {
    expect(written(withDate('ABT 1801', 'around the turn of the century'))).toContain(
      '3 PHRASE around the turn of the century',
    );
  });

  it('drops a phrase in 5.5.1 and reports it, since that version has no such structure', () => {
    const source = withDate('ABT 1801', 'around the turn of the century');
    expect(written(source, '5.5.1').some((line) => line.includes('PHRASE'))).toBe(false);
    expect(notesOf(source, '5.5.1')).toContain(
      'GEDCOM 5.5.1 has no PHRASE structure; the phrase under DATE was not written.',
    );
  });

  it('reports nothing where 5.5.1 already carries the phrase in the payload', () => {
    // `INT <date> (<phrase>)` is 5.5.1's own way of saying it. The phrase is written, inside the
    // value, so calling it lost would be false.
    const source = withDate('INT 1830 (as the register put it)', 'as the register put it');
    expect(written(source, '5.5.1')).toContain('2 DATE INT 1830 (as the register put it)');
    expect(notesOf(source, '5.5.1').some((note) => note.includes('PHRASE'))).toBe(false);
  });
});

describe('structures the model does not describe', () => {
  it('writes them back against their record, in the order they arrived', () => {
    const source = doc({
      individuals: [
        {
          xref: '@I1@',
          sex: 'F',
          extensions: [
            { tag: '_UID', payload: '4F2A-INVENTED-0001' },
            {
              tag: '_ORIGIN',
              payload: 'kept',
              children: [{ tag: '_DETAIL', payload: 'verbatim' }],
            },
          ],
        },
      ],
    });
    expect(written(source)).toEqual([
      '0 HEAD',
      '1 GEDC',
      '2 VERS 7.0',
      '0 @I1@ INDI',
      '1 SEX F',
      '1 _UID 4F2A-INVENTED-0001',
      '1 _ORIGIN kept',
      '2 _DETAIL verbatim',
      '0 TRLR',
    ]);
  });

  it('writes whole records outside the model verbatim, identifier and all', () => {
    const source = doc({
      otherRecords: [
        { xref: '@S1@', tag: 'SOUR', children: [{ tag: 'TITL', payload: 'A source record' }] },
      ],
    });
    expect(written(source)).toContain('0 @S1@ SOUR');
    expect(written(source)).toContain('1 TITL A source record');
  });
});

describe('the record list', () => {
  it('runs header, individuals, families, everything else, trailer', () => {
    const source = doc({
      individuals: [{ xref: '@I1@' }],
      families: [{ xref: '@F1@' }],
      otherRecords: [{ xref: '@S1@', tag: 'SOUR' }],
    });
    expect(toRecords(source).records.map((record) => record.tag)).toEqual([
      'HEAD',
      'INDI',
      'FAM',
      'SOUR',
      'TRLR',
    ]);
  });

  it('writes a trailer even though the importer drops the one it read', () => {
    // The trailer says only "the file ends here", so it is regenerated rather than remembered.
    expect(written(empty).at(-1)).toBe('0 TRLR');
  });
});

describe('the JSON form', () => {
  const source = doc({
    individuals: [{ xref: '@I1@', names: [{ value: 'Aurora /Primera/' }], sex: 'X' }],
  });

  it('validates against the contract and reads back as the same document', () => {
    const parsed: unknown = JSON.parse(exportJson(source));
    expect(validateDoc(parsed).ok).toBe(true);
    expect(parsed).toEqual(source);
  });

  it('has nothing to downgrade, so it loses nothing GEDCOM would', () => {
    // The JSON is the document. There is no dialect to translate into and therefore no note to
    // report -- which is the point of offering it alongside the two GEDCOM versions.
    expect(exportJson(source)).toContain('"sex": "X"');
  });
});
