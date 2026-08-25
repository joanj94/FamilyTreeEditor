/**
 * Bytes to text: what the file declares, and how to honour it.
 *
 * The diacritic corpus below is written for this test. It is not drawn from any real chart, and
 * the letters in it were chosen to exercise the decoder rather than to spell anyone's name.
 */
import { describe, expect, it } from 'vitest';

import { decodeAnsel, decodeGedcom } from './encoding.js';

const bytes = (...values: number[]) => Uint8Array.from(values);

const utf8 = (text: string) => new TextEncoder().encode(text);

/** `0 HEAD` / `1 CHAR <declared>` / `0 TRLR`, as ASCII bytes. */
function headerDeclaring(declared: string): Uint8Array {
  return utf8(`0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR ${declared}\n0 TRLR\n`);
}

describe('decodeGedcom', () => {
  it('detects UTF-8 from a byte-order mark and does not leave it in the text', () => {
    const result = decodeGedcom(bytes(0xef, 0xbb, 0xbf, 0x30, 0x20, 0x48, 0x45, 0x41, 0x44));
    expect(result.encoding).toBe('UTF-8');
    expect(result.detectedFrom).toBe('bom');
    expect(result.text).toBe('0 HEAD');
  });

  it('detects UTF-16 from a byte-order mark, in both byte orders', () => {
    const le = bytes(0xff, 0xfe, 0x30, 0x00, 0x20, 0x00, 0x48, 0x00);
    const be = bytes(0xfe, 0xff, 0x00, 0x30, 0x00, 0x20, 0x00, 0x48);
    expect(decodeGedcom(le)).toMatchObject({ encoding: 'UTF-16LE', text: '0 H' });
    expect(decodeGedcom(be)).toMatchObject({ encoding: 'UTF-16BE', text: '0 H' });
  });

  it('reads the encoding the header declares', () => {
    const result = decodeGedcom(headerDeclaring('ANSEL'));
    expect(result.encoding).toBe('ANSEL');
    expect(result.declared).toBe('ANSEL');
    expect(result.detectedFrom).toBe('header');
  });

  it('records what the header declared even when it means something else', () => {
    // ANSI is not a character set. It is what writers of the period called Windows-1252, and a
    // file saying so must still be read. The declared text is kept so a report can quote it.
    const result = decodeGedcom(headerDeclaring('ANSI'));
    expect(result.encoding).toBe('ANSI');
    expect(result.declared).toBe('ANSI');
  });

  it('decodes ANSI as Windows-1252 rather than as Latin-1', () => {
    // The two differ in 0x80-0x9F, where Windows-1252 puts typographic punctuation. A file with a
    // curly apostrophe in a name decodes to a control character under Latin-1.
    const source = Uint8Array.from([...utf8('1 CHAR ANSI\n1 NOTE '), 0x92, ...utf8('\n')]);
    expect(decodeGedcom(source).text).toContain('’');
  });

  it('defaults to UTF-8 when the file declares nothing', () => {
    // GEDCOM 7 requires UTF-8 and does not use CHAR at all, so silence means UTF-8.
    const result = decodeGedcom(utf8('0 HEAD\n1 GEDC\n2 VERS 7.0\n0 TRLR\n'));
    expect(result).toMatchObject({ encoding: 'UTF-8', detectedFrom: 'default' });
    expect(result.declared).toBeUndefined();
  });

  it('reports an encoding it does not know, rather than guessing quietly', () => {
    const result = decodeGedcom(headerDeclaring('KOI8-R'));
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.observed).toBe('KOI8-R');
    // It still decodes, as UTF-8, because refusing to open the file helps nobody.
    expect(result.text).toContain('0 HEAD');
  });
});

describe('decodeAnsel', () => {
  it('puts a combining diacritic after its base character, not before', () => {
    // This is the whole of ANSEL's difficulty. The diacritic byte PRECEDES the letter it sits on,
    // where Unicode has it follow. Decoding in source order produces a mark on the wrong letter.
    const { text } = decodeAnsel(bytes(0xe2, 0x65)); // acute, then `e`
    expect(text).toBe('é');
    expect(text).toHaveLength(1); // composed, not `e` + U+0301
  });

  it('leaves the letters around a diacritic where they were', () => {
    const { text } = decodeAnsel(bytes(0x61, 0xe2, 0x65, 0x69)); // a, acute, e, i
    expect(text).toBe('aéi');
  });

  it('decodes a purpose-written diacritic corpus exactly', () => {
    const corpus: ReadonlyArray<readonly [readonly number[], string]> = [
      [[0xe1, 0x65], 'è'], // grave
      [[0xe2, 0x61], 'á'], // acute
      [[0xe3, 0x6f], 'ô'], // circumflex
      [[0xe4, 0x6e], 'ñ'], // tilde
      [[0xe5, 0x6f], 'ō'], // macron
      [[0xe6, 0x67], 'ğ'], // breve
      [[0xe7, 0x7a], 'ż'], // dot above
      [[0xe8, 0x75], 'ü'], // diaeresis
      [[0xe9, 0x73], 'š'], // caron
      [[0xea, 0x61], 'å'], // ring above
      [[0xee, 0x6f], 'ő'], // double acute
      [[0xf0, 0x63], 'ç'], // cedilla
      [[0xf1, 0x61], 'ą'], // ogonek
      [[0xf2, 0x73], 'ṣ'], // dot below
    ];
    for (const [source, expected] of corpus) {
      expect(decodeAnsel(bytes(...source)).text).toBe(expected);
    }
  });

  it('applies more than one diacritic to the same letter', () => {
    // ANSEL stacks them before the base, outermost first.
    const { text, issues } = decodeAnsel(bytes(0xe8, 0xe2, 0x75));
    expect(issues).toEqual([]);
    expect(text.normalize('NFD')).toBe('ú̈');
  });

  it('decodes the spacing characters at their real code points', () => {
    // Two published tables disagree by one place across this range. These are the values both
    // sources agree on; getting them wrong turns every special character into its neighbour.
    const cases: ReadonlyArray<readonly [number, string]> = [
      [0xa1, 'Ł'],
      [0xa2, 'Ø'],
      [0xa5, 'Æ'],
      [0xb1, 'ł'],
      [0xb5, 'æ'],
      [0xb9, '£'],
      [0xc5, '¿'],
      [0xc6, '¡'],
    ];
    for (const [code, expected] of cases) {
      expect(decodeAnsel(bytes(code)).text).toBe(expected);
    }
  });

  it('passes ASCII through untouched', () => {
    const { text, issues } = decodeAnsel(utf8('1 NAME GivenA /SurnameA/'));
    expect(text).toBe('1 NAME GivenA /SurnameA/');
    expect(issues).toEqual([]);
  });

  it('reports a byte ANSEL does not define, naming the byte', () => {
    const { issues } = decodeAnsel(bytes(0x41, 0xa0, 0x42));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.observed).toBe('0xA0');
    expect(issues[0]?.offset).toBe(1);
  });

  it('reports a diacritic left with nothing to sit on', () => {
    // A trailing combining byte means the file is truncated or malformed. Emitting the mark on
    // its own would put an accent on whatever letter came next in the display.
    const { issues } = decodeAnsel(bytes(0x41, 0xe2));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/diacritic/i);
  });
});
