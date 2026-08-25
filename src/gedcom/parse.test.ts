/**
 * The parse tree: levels become nesting, and continuation lines become the text they continue.
 *
 * Still no tag means anything here. What comes out is the shape of the file, which the dialect
 * mappers then read meaning from.
 *
 * Every fixture is written for the case it tests. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { parseGedcom, parseRecords } from './parse.js';
import { tokenize } from './lexer.js';

const parse = (text: string) => parseGedcom(text);

describe('parseRecords', () => {
  it('nests substructures by level', () => {
    const { records, issues } = parse('0 HEAD\n1 GEDC\n2 VERS 7.0\n');
    expect(issues).toEqual([]);
    expect(records).toEqual([
      {
        tag: 'HEAD',
        children: [{ tag: 'GEDC', children: [{ tag: 'VERS', payload: '7.0' }] }],
      },
    ]);
  });

  it('keeps a record identifier on the record', () => {
    const { records } = parse('0 @I1@ INDI\n1 SEX M\n');
    expect(records[0]).toEqual({
      xref: '@I1@',
      tag: 'INDI',
      children: [{ tag: 'SEX', payload: 'M' }],
    });
  });

  it('accepts a level-0 record with no identifier', () => {
    // HEAD and TRLR open records and carry no xref. A parser that assumed otherwise would reject
    // the first line of every valid file.
    const { records, issues } = parse('0 HEAD\n0 TRLR\n');
    expect(issues).toEqual([]);
    expect(records.map((r) => r.tag)).toEqual(['HEAD', 'TRLR']);
    expect(records[0]).not.toHaveProperty('xref');
  });

  it('returns records in the order they appeared', () => {
    const { records } = parse('0 HEAD\n0 @I1@ INDI\n0 @F1@ FAM\n0 TRLR\n');
    expect(records.map((r) => r.tag)).toEqual(['HEAD', 'INDI', 'FAM', 'TRLR']);
  });

  it('folds CONT into the payload as a line break', () => {
    const { records } = parse('0 @I1@ INDI\n1 NOTE first\n2 CONT second\n');
    expect(records[0]?.children?.[0]).toEqual({ tag: 'NOTE', payload: 'first\nsecond' });
  });

  it('folds CONC into the payload with no break', () => {
    // CONC exists because 5.5.1 writers split long values across lines. The split is an artefact
    // of the file format, not part of the value, so it does not survive into the document.
    const { records } = parse('0 @I1@ INDI\n1 NOTE half\n2 CONC way\n');
    expect(records[0]?.children?.[0]).toEqual({ tag: 'NOTE', payload: 'halfway' });
  });

  it('treats a CONT with no payload as an empty line', () => {
    const { records } = parse('0 @I1@ INDI\n1 NOTE first\n2 CONT\n2 CONT third\n');
    expect(records[0]?.children?.[0]?.payload).toBe('first\n\nthird');
  });

  it('continues the structure it is nested under, not the last one seen', () => {
    const text = '0 @I1@ INDI\n1 NOTE outer\n2 SOUR @S1@\n3 CONT inner-2\n2 CONT outer-2\n';
    const note = parse(text).records[0]?.children?.[0];
    expect(note?.payload).toBe('outer\nouter-2');
    expect(note?.children?.[0]?.payload).toBe('@S1@\ninner-2');
  });

  it('preserves tags it has never heard of, with their substructures', () => {
    const { records, issues } = parse('0 @I1@ INDI\n1 _CUSTOM value\n2 _INNER deeper\n');
    expect(issues).toEqual([]);
    expect(records[0]?.children).toEqual([
      { tag: '_CUSTOM', payload: 'value', children: [{ tag: '_INNER', payload: 'deeper' }] },
    ]);
  });

  it('keeps a pointer payload as written', () => {
    const { records } = parse('0 @I1@ INDI\n1 FAMC @F1@\n');
    expect(records[0]?.children?.[0]).toEqual({ tag: 'FAMC', payload: '@F1@' });
  });

  it('distinguishes an empty payload from no payload', () => {
    const { records } = parse('0 @I1@ INDI\n1 SEX \n1 BIRT\n');
    expect(records[0]?.children?.[0]).toEqual({ tag: 'SEX', payload: '' });
    expect(records[0]?.children?.[1]).toEqual({ tag: 'BIRT' });
  });

  it('reports a level that skips a depth, and still keeps the line', () => {
    // A jump from 1 to 3 means the file is malformed, but the line still says something. It is
    // attached at the depth it should have had, and the user is told.
    const { records, issues } = parse('0 @I1@ INDI\n1 BIRT\n3 DATE 1 JAN 1901\n');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(3);
    expect(issues[0]?.observed).toBe('3');
    expect(issues[0]?.message).toMatch(/level/i);
    expect(records[0]?.children?.[0]?.children?.[0]).toEqual({
      tag: 'DATE',
      payload: '1 JAN 1901',
    });
  });

  it('reports a substructure that appears before any record', () => {
    const { records, issues } = parse('1 VERS 7.0\n0 HEAD\n');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(1);
    expect(records.map((r) => r.tag)).toEqual(['HEAD']);
  });

  it('surfaces the lexer’s issues alongside its own', () => {
    const { records, issues } = parse('0 HEAD\nX GEDC\n0 TRLR\n');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.observed).toBe('X');
    expect(records.map((r) => r.tag)).toEqual(['HEAD', 'TRLR']);
  });

  it('takes lines directly, so the two stages can be tested apart', () => {
    const { lines } = tokenize('0 @I1@ INDI\n1 SEX F\n');
    expect(parseRecords(lines).records[0]?.tag).toBe('INDI');
  });
});
