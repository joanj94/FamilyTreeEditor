/**
 * Levels into nesting, continuation lines into the text they continue.
 *
 * This is the second and last dialect-agnostic stage. What comes out is the shape of the file --
 * every tag, in order, nested as the levels said -- with no judgement about what any of it means.
 * The mappers read meaning from this; export writes it back. A tag nobody has implemented still
 * survives the whole journey, because at this layer there is no such thing as an unknown tag.
 *
 * **`CONC` and `CONT` are folded away.** They exist because writers split long values across
 * lines, and 5.5.1 producers split them at arbitrary points -- mid-word, and sometimes mid-space.
 * The split is an artefact of the file, not part of the value, so the parse tree holds the joined
 * text and the serializer re-splits on export. This is the one place where a round trip is
 * faithful to the value rather than to the bytes: `1 NOTE half` + `2 CONC way` comes back as one
 * line reading `1 NOTE halfway`, which says the same thing.
 */
import type { Structure } from '../model/types.js';

import { tokenize, type GedcomLine, type LexIssue } from './lexer.js';

/**
 * A level-0 record.
 *
 * `xref` is optional because `HEAD` and `TRLR` open records and carry no identifier. The document
 * model requires one on the records it keeps verbatim, and the mapper is where that distinction
 * is drawn -- here, the file is taken as it is.
 */
export interface ParsedRecord extends Structure {
  readonly xref?: string;
}

export type ParseIssue = LexIssue;

export interface ParseResult {
  readonly records: readonly ParsedRecord[];
  readonly issues: readonly ParseIssue[];
}

/** Mutable while building; converted to the readonly `Structure` shape on the way out. */
interface Node {
  readonly tag: string;
  xref?: string;
  payload?: string;
  readonly children: Node[];
}

function toStructure(node: Node): ParsedRecord {
  return {
    ...(node.xref === undefined ? {} : { xref: node.xref }),
    tag: node.tag,
    ...(node.payload === undefined ? {} : { payload: node.payload }),
    ...(node.children.length === 0 ? {} : { children: node.children.map(toStructure) }),
  };
}

/**
 * Continuation applies to the structure the line is nested under -- its parent -- and not to
 * whatever structure was seen most recently. A `2 CONT` under a `1 NOTE` continues the note even
 * when a `2 SOUR` with its own `3 CONT` sits between them.
 */
function continuedPayload(
  existing: string | undefined,
  tag: string,
  addition: string | undefined,
): string {
  const base = existing ?? '';
  const extra = addition ?? '';
  return tag === 'CONT' ? `${base}\n${extra}` : `${base}${extra}`;
}

/** Build records from already-lexed lines. */
export function parseRecords(lines: readonly GedcomLine[]): ParseResult {
  const records: ParsedRecord[] = [];
  const issues: ParseIssue[] = [];

  /** Open ancestors, `stack[n]` being the structure at level `n`. */
  let stack: Node[] = [];

  const flush = (): void => {
    const root = stack[0];
    if (root !== undefined) records.push(toStructure(root));
  };

  for (const line of lines) {
    if (line.level === 0) {
      flush();
      const root: Node = { tag: line.tag, children: [] };
      if (line.xref !== undefined) root.xref = line.xref;
      if (line.payload !== undefined) root.payload = line.payload;
      stack = [root];
      continue;
    }

    if (stack.length === 0) {
      issues.push({
        line: line.line,
        message: `Expected a level 0 record before a level ${line.level} line, found none.`,
        observed: String(line.level),
      });
      continue;
    }

    // A level deeper than one below the open structure means the file skipped a depth. The line
    // still says something, so it is attached where it should have been and the user is told.
    let level = line.level;
    if (level > stack.length) {
      issues.push({
        line: line.line,
        message: `Expected a level of at most ${stack.length}, found ${level}. Attached at ${stack.length}.`,
        observed: String(level),
      });
      level = stack.length;
    }

    const parent = stack[level - 1];
    if (parent === undefined) continue;

    if (line.tag === 'CONT' || line.tag === 'CONC') {
      parent.payload = continuedPayload(parent.payload, line.tag, line.payload);
      // A continuation is not a structure, so it opens no level of its own.
      stack.length = level;
      continue;
    }

    const node: Node = { tag: line.tag, children: [] };
    if (line.payload !== undefined) node.payload = line.payload;
    parent.children.push(node);
    stack.length = level;
    stack.push(node);
  }

  flush();
  return { records, issues };
}

/** Lex and parse in one step. Issues from both stages arrive together, in line order. */
export function parseGedcom(text: string): ParseResult {
  const { lines, issues: lexIssues } = tokenize(text);
  const { records, issues: parseIssues } = parseRecords(lines);
  const issues = [...lexIssues, ...parseIssues].sort((a, b) => a.line - b.line);
  return { records, issues };
}
