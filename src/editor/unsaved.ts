/**
 * What closing the tab would actually cost.
 *
 * The unload guard used to ask a simpler question -- "has this document been exported?" -- and got
 * it wrong in both directions. It fired the instant a file was opened, before any edit, because
 * nothing had been exported yet; and once a user learns a warning is meaningless they dismiss it
 * reflexively, including on the one occasion it was right. A guard nobody reads is worse than no
 * guard, because it costs a click and buys nothing.
 *
 * The honest question is narrower: **is there work that exists in neither a file the user holds
 * nor this browser's storage?** That splits into exactly two cases.
 *
 * - **Storage is not working** -- a private window, site data switched off, a refused quota. Then
 *   the browser copy is not a copy at all, and anything not exported to a file is lost on close.
 * - **Storage is working** -- then closing loses nothing that has reached it, and the tree is
 *   offered again on the opening screen. Only the window between the last edit and the autosave
 *   that follows it is at risk, which is what `pending` reports.
 *
 * Note what is deliberately *not* a reason to warn: having edits that have not been written back
 * to the user's `.ged`. That is a true statement and not a danger, and the status line says it
 * quietly. A page cannot write to the file it was handed, so treating it as an emergency would
 * mean warning on every session that involved any editing at all.
 *
 * Comparison is by reference throughout. Documents are immutable and structurally shared, so two
 * states that are the same object are the same document -- which also means undo back to a state
 * that was exported or stored correctly stops counting as unwritten.
 */
import type { GedcomDoc } from '../model/types.js';

export interface UnwrittenInput {
  /** The document on screen, or `undefined` where no file is open. */
  readonly doc: GedcomDoc | undefined;
  /** The exact document last written out to a file, or `null` if none has been. */
  readonly exported: GedcomDoc | null;
  /** False where this browser is keeping nothing -- see the module comment. */
  readonly persistent: boolean;
  /** True where the document on screen has not yet reached the store. */
  readonly pending: boolean;
}

/** True where closing the tab would lose something. */
export function hasUnwrittenWork({
  doc,
  exported,
  persistent,
  pending,
}: UnwrittenInput): boolean {
  if (doc === undefined) return false;
  if (!persistent) return doc !== exported;
  return pending;
}

/**
 * What the status line should say about where this document has got to.
 *
 * Separate from the guard on purpose: the guard is about danger, and this is about telling the
 * user plainly which of the two kinds of saving has happened, so the words "saved" and "kept" are
 * never doing each other's work.
 */
export function keptSummary(
  input: UnwrittenInput & { readonly savedAt: string | null },
): string {
  if (!input.persistent) {
    return 'This browser is not storing anything, so this tree lasts only as long as the tab.';
  }
  if (input.savedAt === null || input.pending) return 'Keeping this tree in your browser…';
  return 'Kept in this browser';
}
