/**
 * The GEDCOM line grammar, and nothing above it.
 *
 * A GEDCOM file is a flat list of lines, each `level [@xref@] TAG [payload]`. Structure comes from
 * the levels, and meaning from the tags -- neither of which is this module's business. Keeping the
 * lexer ignorant of both is what lets one implementation serve 5.5.1 and 7, and what lets a file
 * full of tags nobody has ever heard of still parse.
 *
 * Decoding happens before this: the caller hands in text, having already turned ANSEL or ANSI or
 * UTF-8 bytes into a string. A lexer that also guessed at encodings would be two problems wearing
 * one coat.
 *
 * **Malformed lines are reported, not thrown.** A user importing a 10,000-line file wants every
 * problem in it, not the first one. Bad lines are skipped and recorded with the text that was
 * actually there; the rest of the file lexes normally.
 */

/** One parsed line. */
export interface GedcomLine {
  /** 1-based line number in the source file, so a report matches what the user sees. */
  readonly line: number;
  readonly level: number;
  /** The record identifier, present only on the line that opens a record. */
  readonly xref?: string;
  readonly tag: string;
  /** The payload as written, unescaped. Absent where the line had none. */
  readonly payload?: string;
  /** True where the payload is a cross-reference rather than text. */
  readonly pointer?: true;
}

export interface LexIssue {
  readonly line: number;
  readonly message: string;
  /** What was actually there, so the message names the problem rather than describing it. */
  readonly observed: string;
}

export interface LexResult {
  readonly lines: readonly GedcomLine[];
  readonly issues: readonly LexIssue[];
}

/** `@` + one or more of A-Z, 0-9, `_` + `@`, per the standard's Xref production. */
const POINTER = /^@[A-Z0-9_]+@$/;

const LEVEL = /^\d+$/;

/**
 * The standard's Tag production: an upper-case letter or underscore, then upper-case letters,
 * digits and underscores.
 *
 * Enforced here because the document model mirrors GEDCOM 7, and GEDCOM 7 has no way to express a
 * tag outside this grammar. A line carrying one used to be kept, at which point the document it
 * produced could not satisfy its own schema -- and since the editor validates before every command,
 * one malformed line in an imported file made every subsequent edit refuse, with a message about a
 * property the user could not see.
 *
 * Skipping it loses the line, which is a real cost and the reason it is reported with the text that
 * was actually there. The alternative is worse: keeping it would mean writing a line back out that
 * no conforming reader can parse, spreading one file's malformation into every export.
 */
const TAG = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Split on every line terminator in circulation. GEDCOM predates the settling of this question,
 * and files travel between systems: CRLF from Windows writers, LF from Unix ones, and bare CR
 * from old Mac ones.
 */
function splitLines(text: string): readonly string[] {
  return text.split(/\r\n|\n|\r/);
}

/**
 * A leading `@` in a payload is escaped by doubling it. Unescaping here means no consumer has to
 * remember to, and means the value a user sees is the value their file meant.
 */
function unescapePayload(payload: string): string {
  return payload.startsWith('@@') ? payload.slice(1) : payload;
}

function line(
  lineNumber: number,
  level: number,
  tag: string,
  xref: string | undefined,
  payload: string | undefined,
  pointer: boolean,
): GedcomLine {
  return {
    line: lineNumber,
    level,
    ...(xref === undefined ? {} : { xref }),
    tag,
    ...(payload === undefined ? {} : { payload }),
    ...(pointer ? { pointer: true as const } : {}),
  };
}

/**
 * Read one line, or explain why it could not be read.
 *
 * The grammar is delimited by single spaces, but the payload may contain any number of them and
 * may end in one, so this splits off the fixed fields by hand rather than tokenising the whole
 * line. `1 NOTE two  spaces ` has a payload of exactly `two  spaces `.
 */
function readLine(raw: string, lineNumber: number): GedcomLine | LexIssue {
  const afterLevel = raw.indexOf(' ');
  const levelText = afterLevel === -1 ? raw : raw.slice(0, afterLevel);

  if (!LEVEL.test(levelText)) {
    return {
      line: lineNumber,
      message: `Expected a level number to open the line, found ${JSON.stringify(levelText)}.`,
      observed: levelText,
    };
  }
  // Leading zeros are not permitted by GEDCOM 7 and are emitted by older writers anyway. Reading
  // them costs nothing; rejecting them would fail the user for their previous program's defect.
  const level = Number.parseInt(levelText, 10);

  if (afterLevel === -1) {
    return {
      line: lineNumber,
      message: 'Expected a tag after the level, found end of line.',
      observed: raw,
    };
  }

  let rest = raw.slice(afterLevel + 1);
  let xref: string | undefined;

  if (rest.startsWith('@') && !rest.startsWith('@@')) {
    const close = rest.indexOf('@', 1);
    if (close !== -1) {
      xref = rest.slice(0, close + 1);
      rest = rest.slice(close + 2);
    }
  }

  const afterTag = rest.indexOf(' ');
  const tag = afterTag === -1 ? rest : rest.slice(0, afterTag);

  if (tag === '') {
    return { line: lineNumber, message: 'Expected a tag, found none.', observed: raw };
  }

  if (!TAG.test(tag)) {
    return {
      line: lineNumber,
      message:
        `Expected a tag of upper-case letters, digits and underscores, found ${JSON.stringify(tag)}. ` +
        `The line was skipped: GEDCOM has no way to express this tag, so keeping it would produce ` +
        `a file no reader could parse.`,
      observed: tag,
    };
  }

  if (afterTag === -1) {
    return line(lineNumber, level, tag, xref, undefined, false);
  }

  const rawPayload = rest.slice(afterTag + 1);

  if (POINTER.test(rawPayload)) {
    return line(lineNumber, level, tag, xref, rawPayload, true);
  }

  return line(lineNumber, level, tag, xref, unescapePayload(rawPayload), false);
}

function isIssue(result: GedcomLine | LexIssue): result is LexIssue {
  return 'message' in result;
}

/** Lex already-decoded GEDCOM text into lines, collecting every problem rather than stopping. */
export function tokenize(text: string): LexResult {
  // A byte-order mark survives decoding as U+FEFF and would otherwise become part of the first
  // level, turning a valid file into one whose first line is unreadable.
  const withoutBom = text.startsWith('﻿') ? text.slice(1) : text;

  const lines: GedcomLine[] = [];
  const issues: LexIssue[] = [];

  splitLines(withoutBom).forEach((raw, index) => {
    // Blank and whitespace-only lines are padding, not data. They are skipped without comment,
    // but the line number carries on counting so a later report matches the user's editor.
    if (raw.trim() === '') return;

    const result = readLine(raw, index + 1);
    if (isIssue(result)) {
      issues.push(result);
    } else {
      lines.push(result);
    }
  });

  return { lines, issues };
}
