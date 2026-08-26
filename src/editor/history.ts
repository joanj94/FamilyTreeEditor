/**
 * Undo and redo, as three lists.
 *
 * **Whole documents are kept, not inverse operations.** An undo stack of inverses is smaller and
 * is wrong in the way that matters: every operation needs a correct inverse, an inverse that is
 * subtly incomplete corrupts the document only after several steps, and the corruption is
 * attributed to whatever the user did last rather than to the undo. Keeping the document itself
 * makes undo exact by construction -- there is nothing to compute, so there is nothing to get
 * wrong -- and the model is immutable and structurally shared, so two states that differ by one
 * name differ by one object and share the rest.
 *
 * `present` is always a document that passed both gates. Nothing invalid is ever committed here,
 * which is why undo cannot walk back into a broken state: no broken state was ever recorded.
 */
import { ref, type MessageRef } from '../i18n/keys.js';
import type { GedcomDoc } from '../model/types.js';

/** One state a user can return to, and what to call it when offering. */
export interface Step {
  readonly doc: GedcomDoc;
  /**
   * What produced this state, phrased for a menu: "Rename GivenA".
   *
   * **Named, not written.** A stack of sentences is a stack frozen in the language it was made
   * in: switch to Catalan after ten edits and the first nine still offer to undo in English.
   * Keeping the reference means the label is rendered when it is shown, so the whole history
   * changes language with the rest of the screen.
   */
  readonly label: MessageRef;
}

export interface History {
  readonly past: readonly Step[];
  readonly present: Step;
  readonly future: readonly Step[];
}

/** How many steps are kept. Beyond this the oldest is dropped rather than growing without end. */
export const DEPTH = 100;

/** A history holding one document and nothing to undo. */
export function begin(doc: GedcomDoc, label: MessageRef = ref('command.begin')): History {
  return { past: [], present: { doc, label }, future: [] };
}

/**
 * Record a new state.
 *
 * The redo list is cleared, because an edit made after an undo is a different branch of history
 * and keeping the old one would let redo replace work the user has since done.
 */
export function commit(history: History, doc: GedcomDoc, label: MessageRef): History {
  const past = [...history.past, history.present].slice(-DEPTH);
  return { past, present: { doc, label }, future: [] };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/** Step back. Returns the history unchanged where there is nothing to undo. */
export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

/** Step forward again. Returns the history unchanged where there is nothing to redo. */
export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

/** What undo would undo, for a menu or a button's title. */
export function undoLabel(history: History): MessageRef | undefined {
  return canUndo(history) ? history.present.label : undefined;
}

/** What redo would redo. */
export function redoLabel(history: History): MessageRef | undefined {
  return history.future[0]?.label;
}
