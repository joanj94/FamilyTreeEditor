/**
 * The lexer turns bytes-already-decoded-to-text into lines. It knows the GEDCOM line grammar and
 * nothing else: no tag means anything to it, and no dialect is assumed.
 *
 * Every fixture here is written for the case it tests. No real genealogy data enters this
 * repository.
 */
import { describe, expect, it } from 'vitest';

import { tokenize } from './lexer.js';

describe('tokenize', () => {
  it('reads level, tag and payload', () => {
    const { lines, issues } = tokenize('0 HEAD\n1 GEDC\n2 VERS 7.0\n');
    expect(issues).toEqual([]);
    expect(lines).toEqual([
      { line: 1, level: 0, tag: 'HEAD' },
      { line: 2, level: 1, tag: 'GEDC' },
      { line: 3, level: 2, tag: 'VERS', payload: '7.0' },
    ]);
  });

  it('reads a record identifier', () => {
    const { lines } = tokenize('0 @I1@ INDI\n');
    expect(lines[0]).toEqual({ line: 1, level: 0, xref: '@I1@', tag: 'INDI' });
  });

  it('recognises a pointer payload as a pointer, not as text', () => {
    // `1 FAMC @F1@` links to a record. Deciding this at the lexer keeps every consumer from
    // re-testing the payload shape.
    const { lines } = tokenize('1 FAMC @F1@\n');
    expect(lines[0]).toEqual({
      line: 1,
      level: 1,
      tag: 'FAMC',
      payload: '@F1@',
      pointer: true,
    });
  });

  it('treats @VOID@ as a pointer', () => {
    const { lines } = tokenize('1 FAMC @VOID@\n');
    expect(lines[0]?.pointer).toBe(true);
  });

  it('unescapes a payload that begins with @@', () => {
    // The standard escapes a literal leading @ by doubling it. Left escaped, the text would come
    // back to the user with a character they never typed.
    const { lines } = tokenize('1 NOTE @@home\n');
    expect(lines[0]?.payload).toBe('@home');
    expect(lines[0]?.pointer).toBeUndefined();
  });

  it('accepts every line terminator in the wild', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const { lines, issues } = tokenize(`0 HEAD${eol}0 TRLR${eol}`);
      expect(issues).toEqual([]);
      expect(lines.map((l) => l.tag)).toEqual(['HEAD', 'TRLR']);
    }
  });

  it('strips a byte-order mark', () => {
    const { lines, issues } = tokenize('﻿0 HEAD\n');
    expect(issues).toEqual([]);
    expect(lines[0]?.tag).toBe('HEAD');
  });

  it('skips blank lines without losing the line numbers of the rest', () => {
    // A reported line number that does not match the user's editor is worse than no line number.
    const { lines } = tokenize('0 HEAD\n\n   \n0 TRLR\n');
    expect(lines.map((l) => [l.line, l.tag])).toEqual([
      [1, 'HEAD'],
      [4, 'TRLR'],
    ]);
  });

  it('accepts a level written with leading zeros', () => {
    // Not permitted by GEDCOM 7, but produced by older writers. Rejecting a file over this would
    // fail the user for their previous program's defect.
    const { lines, issues } = tokenize('00 HEAD\n01 GEDC\n');
    expect(issues).toEqual([]);
    expect(lines.map((l) => l.level)).toEqual([0, 1]);
  });

  it('reports a level that is not a number, with what it saw', () => {
    const { lines, issues } = tokenize('0 HEAD\nX GEDC\n0 TRLR\n');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(2);
    expect(issues[0]?.observed).toBe('X');
    expect(issues[0]?.message).toMatch(/level/i);
    // The rest of the file still lexes: one bad line is not a reason to abandon the other 10,000.
    expect(lines.map((l) => l.tag)).toEqual(['HEAD', 'TRLR']);
  });

  it('reports a line with no tag', () => {
    const { issues } = tokenize('1\n');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/tag/i);
  });

  it('keeps an extension tag as written', () => {
    const { lines, issues } = tokenize('1 _UID PLACEHOLDER\n');
    expect(issues).toEqual([]);
    expect(lines[0]?.tag).toBe('_UID');
  });

  it('preserves whitespace inside and after a payload', () => {
    // Trailing spaces carry meaning across a CONC split, so the lexer must not tidy them away.
    const { lines } = tokenize('1 NOTE two  spaces \n');
    expect(lines[0]?.payload).toBe('two  spaces ');
  });

  it('distinguishes an empty payload from no payload at all', () => {
    const { lines } = tokenize('1 NOTE \n1 NOTE\n');
    expect(lines[0]?.payload).toBe('');
    expect(lines[1]?.payload).toBeUndefined();
  });
});
