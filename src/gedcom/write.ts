/**
 * Structures back to lines: the inverse of `lexer.ts` and `parse.ts`.
 *
 * This layer knows nothing about what any tag means. It is handed a tree and it writes levels,
 * identifiers, payloads and continuations -- exactly the grammar the lexer reads, and nothing
 * above it. Keeping it ignorant is what lets one writer serve 5.5.1 and 7, and what lets a record
 * full of tags nobody has implemented be written back as faithfully as an `INDI`.
 *
 * Three details are load-bearing, and each of them is a way a round trip is quietly lost:
 *
 * 1. **A leading `@` is doubled.** The lexer unescapes `@@` back to `@`, so a payload that begins
 *    with `@` and is not a pointer has to be written escaped or it comes back as a pointer, or as
 *    a shorter string.
 * 2. **A newline inside a payload becomes `CONT`.** The parse tree holds joined text because the
 *    split is an artefact of the file rather than part of the value; writing it means splitting
 *    again, at the newlines the value actually contains.
 * 3. **An empty payload is written with its space.** `1 TAG` and `1 TAG ` are different lines: the
 *    first has no payload, the second has an empty one, and the model distinguishes them. Writing
 *    the shorter form for both would silently merge two states the parser took care to separate.
 *
 * Line length is a 5.5.1 concern only. That version asks for lines of at most 255 characters and
 * splits longer values with `CONC`; GEDCOM 7 removed both the limit and the tag.
 */
import type { Structure } from '../model/types.js';

import type { ParsedRecord } from './parse.js';

/** 5.5.1's maximum line length, in characters, including the level and the tag. */
export const MAX_LINE_5551 = 255;

export interface WriteOptions {
  /**
   * The longest line to write before continuing with `CONC`, or `undefined` for no limit.
   * GEDCOM 7 passes `undefined`: it removed `CONC` altogether.
   */
  readonly maxLineLength?: number;
  /** The line terminator. Both are read back; `\n` is written unless a caller wants otherwise. */
  readonly terminator?: string;
}

/** `@` + one or more of A-Z, 0-9, `_` + `@`, per the standard's Xref production. */
const POINTER = /^@[A-Z0-9_]+@$/;

/**
 * Double a leading `@` unless the payload is a pointer.
 *
 * The lexer's rule read backwards: it treats a payload matching the pointer grammar as a pointer
 * and leaves it alone, and unescapes anything else that opens with `@@`.
 */
function escapePayload(text: string): string {
  return !text.startsWith('@') || POINTER.test(text) ? text : `@${text}`;
}

const prefixOf = (level: number, tag: string, xref: string | undefined): string =>
  xref === undefined ? `${String(level)} ${tag}` : `${String(level)} ${xref} ${tag}`;

/**
 * Split one newline-free segment into pieces that fit.
 *
 * Works in code points rather than UTF-16 units, so a split never lands between the halves of a
 * surrogate pair and turns an emoji or an archaic character into two replacement characters.
 *
 * Two adjustments, both about what happens to the text after it leaves here. A piece that opens
 * with `@` will be written one character longer than it is, because of the escape, so it is taken
 * one character shorter. And a piece is not allowed to end on a space where more follows: trailing
 * whitespace is the first thing a careless reader strips, and the space is safe at the head of the
 * next piece instead.
 */
function splitSegment(
  segment: string,
  headBudget: number,
  contBudget: number,
): readonly string[] {
  if (headBudget >= segment.length && contBudget >= segment.length) return [segment];

  const points = Array.from(segment);
  const pieces: string[] = [];
  let index = 0;
  let budget = headBudget;

  while (index < points.length) {
    const remaining = points.length - index;
    // A budget of zero or less would never advance, so one character is always taken. The line
    // then exceeds the limit, which is a recommendation; a serializer that hangs is not.
    let take = Math.min(Math.max(budget, 1), remaining);

    if (points[index] === '@' && take === budget && take > 1) take -= 1;

    if (take < remaining) {
      let trimmed = take;
      while (trimmed > 1 && points[index + trimmed - 1] === ' ') trimmed -= 1;
      if (points[index + trimmed - 1] !== ' ') take = trimmed;
    }

    pieces.push(points.slice(index, index + take).join(''));
    index += take;
    budget = contBudget;
  }

  return pieces;
}

/** Write one structure and everything under it. */
function writeStructure(
  out: string[],
  node: Structure,
  level: number,
  xref: string | undefined,
  limit: number | undefined,
): void {
  const head = prefixOf(level, node.tag, xref);
  const payload = node.payload;

  if (payload === undefined || payload === null) {
    out.push(head);
  } else {
    // A newline in the value is a `CONT`; the split at 255 characters is a `CONC`. Doing the
    // newlines first is what makes them survive: `CONC` joins with nothing, `CONT` with a newline,
    // so a break introduced for length must never be written as the one that adds a line.
    const contPrefix = prefixOf(level + 1, 'CONT', undefined);
    const concPrefix = prefixOf(level + 1, 'CONC', undefined);

    payload.split('\n').forEach((segment, segmentIndex) => {
      const isFirst = segmentIndex === 0;
      const linePrefix = isFirst ? head : contPrefix;

      const pieces =
        limit === undefined
          ? [segment]
          : splitSegment(segment, limit - linePrefix.length - 1, limit - concPrefix.length - 1);

      pieces.forEach((piece, pieceIndex) => {
        const prefix = pieceIndex === 0 ? linePrefix : concPrefix;
        // An empty continuation is written without its space: `CONT` alone already says newline,
        // and the parser reads a missing payload and an empty one the same way on a continuation.
        // The opening line is not so lucky, which is why it keeps the space -- see the note above.
        if (piece === '' && !(isFirst && pieceIndex === 0)) {
          out.push(prefix);
        } else {
          out.push(`${prefix} ${escapePayload(piece)}`);
        }
      });
    });
  }

  for (const child of node.children ?? []) {
    writeStructure(out, child, level + 1, undefined, limit);
  }
}

/**
 * Write records as GEDCOM text.
 *
 * The records are written in the order given, identifiers and all. Nothing is added: a caller that
 * wants a header and a trailer passes them, because deciding what belongs in a file is a question
 * about GEDCOM's meaning and this module does not have opinions about that.
 */
export function writeLines(
  records: readonly ParsedRecord[],
  options: WriteOptions = {},
): string {
  const terminator = options.terminator ?? '\n';
  const out: string[] = [];

  for (const record of records) {
    writeStructure(out, record, 0, record.xref, options.maxLineLength);
  }

  return out.length === 0 ? '' : `${out.join(terminator)}${terminator}`;
}
