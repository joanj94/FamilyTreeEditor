/**
 * Where a tree lives between visits, and the seam a backend would slot into.
 *
 * The editor talks to this interface and never to IndexedDB, so the day a server appears it
 * implements four methods and nothing above it changes. That is the whole reason the interface
 * exists ahead of the need: retrofitting a seam through code that has already reached into a
 * concrete store is the expensive version of this work.
 *
 * **Every method returns a promise, including the ones an in-memory store answers instantly.** A
 * synchronous interface would be honest about today's implementation and wrong about every other
 * one, and the callers would have to be rewritten to find out.
 *
 * **What is stored is the document, not the file.** A `.ged` is what the user brought and what
 * they will take away; the document is what this editor understands, and it round-trips back to a
 * file exactly (see `gedcom/serialize.ts`). Storing the text instead would mean re-parsing on every
 * load and deciding, each time, which dialect to keep it in.
 *
 * **What is not stored: the undo stack.** History belongs to a session. Restoring somebody's redo
 * queue from last week would be a promise about intent that this tool cannot keep.
 */
import { validateDoc } from '../model/validate.js';
import type { GedcomDoc } from '../model/types.js';

/** A tree as it is kept: the document, and enough about it to be found again. */
export interface StoredTree {
  /** Stable for the life of the tree. Assigned when it is first stored, never reused. */
  readonly id: string;
  /** The name of the file it came from, which is what the user will recognise it by. */
  readonly name: string;
  /** When it was last written, as an ISO 8601 instant. */
  readonly savedAt: string;
  readonly doc: GedcomDoc;
}

/**
 * Enough to draw a list without opening anything.
 *
 * Derived from the stored document rather than written beside it. A count kept alongside can
 * disagree with the document it describes; a count computed from it cannot.
 */
export interface TreeSummary {
  readonly id: string;
  readonly name: string;
  readonly savedAt: string;
  readonly people: number;
  readonly families: number;
}

/**
 * The store.
 *
 * Four methods, deliberately: anything richer -- querying, partial updates, transactions across
 * trees -- would be a shape a future backend has to match rather than one it gets to choose.
 */
export interface TreeRepository {
  /** Every tree held, newest first. */
  list: () => Promise<readonly TreeSummary[]>;
  /** The tree with that identifier, or `undefined` where there is none. */
  load: (id: string) => Promise<StoredTree | undefined>;
  /** Write a tree, replacing any tree already held under the same identifier. */
  save: (tree: StoredTree) => Promise<void>;
  /** Forget a tree. Removing one that is not there is not an error. */
  remove: (id: string) => Promise<void>;
}

/**
 * Read a stored tree down to what a list needs.
 *
 * Defensive about the document, because what comes back out of storage crossed both time and
 * versions to get here: a record written by a later build, or edited by hand in devtools, must
 * still be listable. A tree that cannot be counted is shown with no counts rather than taking the
 * whole list down with it -- and `load` is where the user finds out it cannot be opened.
 */
export const summarise = (tree: StoredTree): TreeSummary => ({
  id: tree.id,
  name: tree.name,
  savedAt: tree.savedAt,
  people: Array.isArray(tree.doc?.individuals) ? tree.doc.individuals.length : 0,
  families: Array.isArray(tree.doc?.families) ? tree.doc.families.length : 0,
});

/**
 * Read something that came out of storage as a stored tree, or explain why it is not one.
 *
 * The envelope is checked here and the document by the schema, because storage is a boundary in
 * the same sense a file is: the data crossed out of this program's control and came back. Casting
 * it and hoping was the shape of the problem -- a malformed record reached the renderer as though
 * the parser had produced it.
 */
export function readStoredTree(
  value: unknown,
): { ok: true; tree: StoredTree } | { ok: false; problem: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, problem: 'the stored record is not an object' };
  }
  const record = value as Partial<StoredTree>;
  for (const field of ['id', 'name', 'savedAt'] as const) {
    if (typeof record[field] !== 'string') {
      return { ok: false, problem: `the stored record has no ${field}` };
    }
  }
  const validation = validateDoc(record.doc);
  if (!validation.ok) {
    const first = validation.errors[0];
    return {
      ok: false,
      problem:
        first === undefined
          ? 'the stored document does not match the schema'
          : `the stored document does not match the schema: ${first.path} ${first.message}`,
    };
  }
  return { ok: true, tree: { ...(record as StoredTree), doc: validation.doc } };
}

/** Newest first, and by identifier where two were written in the same millisecond. */
export const byNewest = (a: TreeSummary, b: TreeSummary): number =>
  b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id);

/**
 * An identifier for a tree that has not been stored before.
 *
 * `crypto.randomUUID` where it exists, which is every browser this app supports and Node 19 and
 * up. The fallback is not a security measure and does not pretend to be one -- these identify rows
 * in one person's own browser, and the only property required is that two trees stored a moment
 * apart do not collide.
 */
export function newTreeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tree-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
