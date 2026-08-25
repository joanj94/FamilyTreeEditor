/**
 * The line grammar, written rather than read.
 *
 * Every test here has the same shape underneath: write something, lex it back, and check it says
 * what it said before. That is the only assertion that matters for this layer, because the file it
 * produces has exactly one consumer whose opinion counts -- a parser.
 *
 * Every fixture is written for the case it tests. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { parseGedcom } from './parse.js';
import { MAX_LINE_5551, writeLines } from './write.js';
import type { Structure } from '../model/types.js';

const lines = (text: string): readonly string[] => text.split('\n').slice(0, -1);

/** Write, read back, and hand over the payload of the first record. */
const rewritten = (
  payload: string | null | undefined,
  limit?: number,
): string | null | undefined => {
  const text = writeLines(
    [{ xref: '@N1@', tag: 'NOTE', ...(payload === undefined ? {} : { payload }) }],
    limit === undefined ? {} : { maxLineLength: limit },
  );
  return parseGedcom(text).records[0]?.payload;
};

describe('levels and identifiers', () => {
  it('writes nesting as the depth of the structure', () => {
    const record: Structure = {
      tag: 'INDI',
      children: [{ tag: 'BIRT', children: [{ tag: 'DATE', payload: '1801' }] }],
    };
    expect(lines(writeLines([{ ...record, xref: '@I1@' }]))).toEqual([
      '0 @I1@ INDI',
      '1 BIRT',
      '2 DATE 1801',
    ]);
  });

  it('writes an identifier only on the line that opens the record', () => {
    // The grammar allows one nowhere else, and a substructure carrying one would not lex.
    const text = writeLines([
      { xref: '@F1@', tag: 'FAM', children: [{ tag: 'CHIL', payload: '@I1@' }] },
    ]);
    expect(lines(text)).toEqual(['0 @F1@ FAM', '1 CHIL @I1@']);
  });

  it('writes nothing for no records, rather than a stray terminator', () => {
    expect(writeLines([])).toBe('');
  });
});

describe('payloads', () => {
  it('distinguishes a line with no payload from one whose payload is empty', () => {
    // `1 NOTE` and `1 NOTE ` are different lines and the model keeps them apart, so the writer
    // has to as well: collapsing them would quietly merge two states the parser separated.
    expect(rewritten(undefined)).toBeUndefined();
    expect(rewritten('')).toBe('');
    expect(lines(writeLines([{ xref: '@N1@', tag: 'NOTE', payload: '' }]))).toEqual([
      '0 @N1@ NOTE ',
    ]);
  });

  it('writes a null payload as a line with no payload, which is what null means', () => {
    expect(lines(writeLines([{ xref: '@N1@', tag: 'NOTE', payload: null }]))).toEqual([
      '0 @N1@ NOTE',
    ]);
  });

  it('keeps spaces inside and at the end of a payload', () => {
    expect(rewritten('two  spaces ')).toBe('two  spaces ');
  });
});

describe('the leading at sign', () => {
  it('doubles it, so the value survives the reader unescaping it', () => {
    expect(lines(writeLines([{ tag: 'NOTE', payload: '@ not a pointer' }]))).toEqual([
      '0 NOTE @@ not a pointer',
    ]);
    expect(rewritten('@ not a pointer')).toBe('@ not a pointer');
  });

  it('leaves a pointer alone', () => {
    expect(lines(writeLines([{ tag: 'CHIL', payload: '@I1@' }]))).toEqual(['0 CHIL @I1@']);
    expect(rewritten('@I1@')).toBe('@I1@');
  });

  it('round-trips a payload that is only at signs', () => {
    expect(rewritten('@')).toBe('@');
    expect(rewritten('@@')).toBe('@@');
  });
});

describe('newlines', () => {
  it('writes each one as CONT, one level in', () => {
    expect(lines(writeLines([{ tag: 'NOTE', payload: 'first\nsecond' }]))).toEqual([
      '0 NOTE first',
      '1 CONT second',
    ]);
    expect(rewritten('first\nsecond')).toBe('first\nsecond');
  });

  it('writes a blank line as a bare CONT, and reads it back as one', () => {
    expect(lines(writeLines([{ tag: 'NOTE', payload: 'a\n\nb' }]))).toEqual([
      '0 NOTE a',
      '1 CONT',
      '1 CONT b',
    ]);
    expect(rewritten('a\n\nb')).toBe('a\n\nb');
  });

  it('round-trips a payload that opens or closes with a newline', () => {
    expect(rewritten('\nafter')).toBe('\nafter');
    expect(rewritten('before\n')).toBe('before\n');
  });
});

describe('line length', () => {
  const long = 'x'.repeat(1000);

  it('leaves a long value on one line when no limit is given, as GEDCOM 7 wants', () => {
    // 7.0 removed both the 255-character limit and the CONC tag that worked around it.
    const written = lines(writeLines([{ tag: 'NOTE', payload: long }]));
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(`0 NOTE ${long}`);
  });

  it('splits with CONC at the limit, and joins back to the same value', () => {
    const written = lines(
      writeLines([{ tag: 'NOTE', payload: long }], { maxLineLength: MAX_LINE_5551 }),
    );
    expect(written.length).toBeGreaterThan(1);
    for (const line of written) expect(line.length).toBeLessThanOrEqual(MAX_LINE_5551);
    expect(written.slice(1).every((line) => line.startsWith('1 CONC '))).toBe(true);
    expect(rewritten(long, MAX_LINE_5551)).toBe(long);
  });

  it('does not end a continued piece on a space', () => {
    // Trailing whitespace is the first thing a careless reader strips. The space is safe at the
    // head of the next piece, where nothing is tempted to trim it.
    const payload = `${'word '.repeat(200)}end`;
    const written = lines(writeLines([{ tag: 'NOTE', payload }], { maxLineLength: 40 }));
    for (const line of written) expect(line.endsWith(' ')).toBe(false);
    expect(rewritten(payload, 40)).toBe(payload);
  });

  it('never splits a character in half', () => {
    // Splitting by UTF-16 unit would land between the halves of a surrogate pair and turn one
    // character into two replacement characters -- silently, and only for some users' files.
    const payload = '\u{1D11E}'.repeat(60);
    expect(rewritten(payload, 40)).toBe(payload);
  });

  it('makes progress even where the limit leaves no room for the payload', () => {
    // A limit shorter than the prefix cannot be honoured. Exceeding it is a defect in the output;
    // looping forever is a defect in the program, and the second is worse.
    const written = lines(
      writeLines([{ tag: 'NOTE', payload: 'abcdef' }], { maxLineLength: 4 }),
    );
    expect(written.length).toBeGreaterThan(0);
    expect(rewritten('abcdef', 4)).toBe('abcdef');
  });

  it('accounts for the escape when a piece begins with an at sign', () => {
    const payload = `${'y'.repeat(30)}@${'z'.repeat(30)}`;
    const written = lines(writeLines([{ tag: 'NOTE', payload }], { maxLineLength: 20 }));
    for (const line of written) expect(line.length).toBeLessThanOrEqual(20);
    expect(rewritten(payload, 20)).toBe(payload);
  });

  it('splits a value that also contains newlines without confusing the two', () => {
    // CONC joins with nothing and CONT joins with a newline. A break introduced for length that
    // was written as CONT would insert a line the value never had.
    const payload = `${'a'.repeat(400)}\n${'b'.repeat(400)}`;
    expect(rewritten(payload, MAX_LINE_5551)).toBe(payload);
  });
});

describe('the terminator', () => {
  it('ends every line, including the last', () => {
    expect(writeLines([{ tag: 'TRLR' }])).toBe('0 TRLR\n');
  });

  it('can be CRLF for a reader that insists on it', () => {
    const text = writeLines([{ tag: 'TRLR' }], { terminator: '\r\n' });
    expect(text).toBe('0 TRLR\r\n');
    expect(parseGedcom(text).records).toHaveLength(1);
  });
});
