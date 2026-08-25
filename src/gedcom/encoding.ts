/**
 * Bytes to text.
 *
 * This runs before the lexer, and it is the reason the lexer takes a string: guessing at
 * encodings and parsing a grammar are two problems, and a module that did both would be worse at
 * each. Everything downstream can then assume Unicode.
 *
 * **Why this is load-bearing rather than cosmetic.** The tool round-trips: a character
 * mis-decoded on the way in is written back out corrupted, into the user's own file. That is the
 * same class of failure as dropping an unknown tag, and it is why a mis-decoded accent is treated
 * here as a defect rather than a display quirk.
 *
 * GEDCOM 7 settles the question -- it is UTF-8 and has no `CHAR` tag at all. 5.5.1 does not: a
 * file declares `1 CHAR` as `UTF-8`, `UNICODE`, `ASCII`, `ANSI` or **`ANSEL`**, and the last of
 * those is a 1980s library encoding no browser API decodes.
 */

/** What the bytes turned out to be. `ANSI` is Windows-1252; the name is what files call it. */
export type GedcomEncoding = 'UTF-8' | 'UTF-16LE' | 'UTF-16BE' | 'ANSEL' | 'ASCII' | 'ANSI';

export interface DecodeIssue {
  readonly message: string;
  /** What was actually there: a byte, or the text a header declared. */
  readonly observed: string;
  /** Byte offset, where the problem is a byte rather than a declaration. */
  readonly offset?: number;
}

export interface DecodeResult {
  readonly text: string;
  readonly encoding: GedcomEncoding;
  /** The `1 CHAR` payload as written, kept so a report can quote the file rather than paraphrase. */
  readonly declared?: string;
  readonly detectedFrom: 'bom' | 'header' | 'default';
  readonly issues: readonly DecodeIssue[];
}

/**
 * ANSEL spacing characters, 0xA1-0xC6.
 *
 * Two published tables disagree by one place across this range. These are the values that the
 * ANSEL standard and `tamurajones.net/GEDCOMANSELTable.xhtml` agree on, and 0xA0 is unassigned in
 * both. An off-by-one here would turn every special character into its neighbour, quietly, inside
 * the user's names.
 */
const ANSEL_SPACING: Readonly<Record<number, string>> = {
  0xa1: 'Ł',
  0xa2: 'Ø',
  0xa3: 'Đ',
  0xa4: 'Þ',
  0xa5: 'Æ',
  0xa6: 'Œ',
  0xa7: 'ʹ',
  0xa8: '·',
  0xa9: '♭',
  0xaa: '®',
  0xab: '±',
  0xac: 'Ơ',
  0xad: 'Ư',
  0xae: 'ʼ',
  0xb0: 'ʻ',
  0xb1: 'ł',
  0xb2: 'ø',
  0xb3: 'đ',
  0xb4: 'þ',
  0xb5: 'æ',
  0xb6: 'œ',
  0xb7: 'ʺ',
  0xb8: 'ı',
  0xb9: '£',
  0xba: 'ð',
  0xbc: 'ơ',
  0xbd: 'ư',
  0xc0: '°',
  0xc1: 'ℓ',
  0xc2: '℗',
  0xc3: '©',
  0xc4: '♯',
  0xc5: '¿',
  0xc6: '¡',
};

/** ANSEL combining diacritics, 0xE0-0xFC, to their Unicode combining marks. */
const ANSEL_COMBINING: Readonly<Record<number, string>> = {
  0xe0: '̉', // hook above
  0xe1: '̀', // grave
  0xe2: '́', // acute
  0xe3: '̂', // circumflex
  0xe4: '̃', // tilde
  0xe5: '̄', // macron
  0xe6: '̆', // breve
  0xe7: '̇', // dot above
  0xe8: '̈', // diaeresis
  0xe9: '̌', // caron
  0xea: '̊', // ring above
  0xeb: '︠', // ligature, left half
  0xec: '︡', // ligature, right half
  0xed: '̕', // comma above right
  0xee: '̋', // double acute
  0xef: '̐', // candrabindu
  0xf0: '̧', // cedilla
  0xf1: '̨', // ogonek
  0xf2: '̣', // dot below
  0xf3: '̤', // diaeresis below
  0xf4: '̥', // ring below
  0xf5: '̳', // double low line
  0xf6: '̲', // low line
  0xf7: '̦', // comma below
  0xf8: '̜', // left half ring below
  0xf9: '̮', // breve below
  0xfa: '︢', // double tilde, left half
  0xfb: '︣', // double tilde, right half
  0xfc: '̓', // comma above
};

/**
 * Decode ANSEL.
 *
 * The one thing that matters: **a diacritic precedes the character it sits on**, where Unicode
 * has it follow. Decoding byte by byte in source order puts every accent on the letter before the
 * one that should carry it, which is the failure this function exists to prevent. Marks are held
 * back until their base arrives, then emitted after it and composed with NFC, so the result is
 * the precomposed character a user expects to see and to search for.
 */
export function decodeAnsel(source: Uint8Array): {
  text: string;
  issues: readonly DecodeIssue[];
} {
  const out: string[] = [];
  const issues: DecodeIssue[] = [];
  let pending: string[] = [];

  const emit = (base: string): void => {
    // ANSEL stacks marks before the base, outermost first; Unicode wants them after it, innermost
    // first. Reversing keeps a doubly-accented letter looking the way the file meant.
    out.push(base, ...[...pending].reverse());
    pending = [];
  };

  source.forEach((byte, offset) => {
    const combining = ANSEL_COMBINING[byte];
    if (combining !== undefined) {
      pending.push(combining);
      return;
    }

    if (byte < 0x80) {
      emit(String.fromCharCode(byte));
      return;
    }

    const spacing = ANSEL_SPACING[byte];
    if (spacing !== undefined) {
      emit(spacing);
      return;
    }

    // A byte ANSEL does not define means the file is not the encoding it claims. The replacement
    // character is visible and reported; it is also the one place ANSEL input cannot be written
    // back byte-for-byte, which is tolerable only because the byte was never valid ANSEL.
    issues.push({
      message: 'Byte is not defined in ANSEL; decoded as the replacement character.',
      observed: `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`,
      offset,
    });
    emit('�');
  });

  if (pending.length > 0) {
    issues.push({
      message: 'File ends with a combining diacritic that has no character to sit on.',
      observed: pending.join(''),
      offset: source.length - pending.length,
    });
    out.push(...pending);
  }

  return { text: out.join('').normalize('NFC'), issues };
}

function decodeWith(label: string, source: Uint8Array): string {
  return new TextDecoder(label).decode(source);
}

/**
 * The header is ASCII-compatible in every single-byte encoding GEDCOM uses, so `1 CHAR` can be
 * read before knowing what the rest of the file is. UTF-16 is the exception, and a byte-order
 * mark settles that before this is reached.
 */
function readDeclaredCharset(source: Uint8Array): string | undefined {
  const head = decodeWith('windows-1252', source.subarray(0, 2048));
  return /^\s*1\s+CHAR\s+(\S+)/im.exec(head)?.[1];
}

const KNOWN: Readonly<Record<string, GedcomEncoding>> = {
  ANSEL: 'ANSEL',
  ASCII: 'ASCII',
  ANSI: 'ANSI',
  'UTF-8': 'UTF-8',
  UTF8: 'UTF-8',
  UNICODE: 'UTF-16LE',
};

/** Decode a GEDCOM file, honouring its byte-order mark or its declaration, in that order. */
export function decodeGedcom(source: Uint8Array): DecodeResult {
  if (source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf) {
    return {
      text: decodeWith('utf-8', source.subarray(3)),
      encoding: 'UTF-8',
      detectedFrom: 'bom',
      issues: [],
    };
  }
  if (source[0] === 0xff && source[1] === 0xfe) {
    return {
      text: decodeWith('utf-16le', source.subarray(2)),
      encoding: 'UTF-16LE',
      detectedFrom: 'bom',
      issues: [],
    };
  }
  if (source[0] === 0xfe && source[1] === 0xff) {
    return {
      text: decodeWith('utf-16be', source.subarray(2)),
      encoding: 'UTF-16BE',
      detectedFrom: 'bom',
      issues: [],
    };
  }

  const declared = readDeclaredCharset(source);
  if (declared === undefined) {
    // GEDCOM 7 requires UTF-8 and has no CHAR tag, so silence means UTF-8.
    return {
      text: decodeWith('utf-8', source),
      encoding: 'UTF-8',
      detectedFrom: 'default',
      issues: [],
    };
  }

  const encoding = KNOWN[declared.toUpperCase()];
  if (encoding === undefined) {
    // Refusing to open the file helps nobody, so it is read as UTF-8 and the user is told what
    // the file claimed and what was done instead.
    return {
      text: decodeWith('utf-8', source),
      encoding: 'UTF-8',
      declared,
      detectedFrom: 'header',
      issues: [
        {
          message:
            'Header declares a character set this tool does not know; read as UTF-8 instead.',
          observed: declared,
        },
      ],
    };
  }

  if (encoding === 'ANSEL') {
    const { text, issues } = decodeAnsel(source);
    return { text, encoding, declared, detectedFrom: 'header', issues };
  }

  // ASCII is decoded as Windows-1252, a superset: a file that declares ASCII and then uses a high
  // byte anyway is common, and reading it is better than mangling it.
  const label =
    encoding === 'UTF-16LE' ? 'utf-16le' : encoding === 'UTF-8' ? 'utf-8' : 'windows-1252';
  return {
    text: decodeWith(label, source),
    encoding,
    declared,
    detectedFrom: 'header',
    issues: [],
  };
}
