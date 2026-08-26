/**
 * A tree that came from no file.
 *
 * Every other route into this editor starts with somebody's `.ged`. Not everybody has one: a
 * person sitting down to record what they know has nothing to open, and until now the opening
 * screen offered them only a file picker they could not use.
 *
 * **It begins with one person, not with nothing.** An empty document is a dead end here rather
 * than a blank page: every edit in this editor is reached through a record -- a partner, parents
 * and children all hang off somebody -- so a chart with no one in it has nothing to click and no
 * way to grow. One nameless individual is the smallest document a user can actually build from,
 * and `displayName` draws them under their identifier so the box can be clicked with confidence.
 *
 * **The header says GEDCOM 7 and names this editor as the source.** `HEAD.SOUR` is where the
 * producing application belongs, and for a document typed in here that is the truth. Nothing sets
 * `origin`: that field records what a file declared, and there was no file.
 */
import { addIndividual } from '../model/ops.js';
import type { GedcomDoc, Xref } from '../model/types.js';

/**
 * What a tree with no file behind it is called.
 *
 * It reaches the user twice -- in the bar, and as the name the save dialog suggests -- so it is
 * something they can recognise and rename rather than a placeholder like `document1`.
 */
export const NEW_TREE_NAME = 'untitled.ged';

/** The label the first history entry carries, and so the one an undo would offer to reverse. */
export const NEW_TREE_LABEL = 'Started a new tree';

export interface BlankTree {
  readonly doc: GedcomDoc;
  /** The person to select, so the record panel opens on something worth typing into. */
  readonly first: Xref;
}

/** A document holding one empty person, ready to be named. */
export function blankTree(): BlankTree {
  const empty: GedcomDoc = {
    header: { gedcomVersion: '7.0', sourceSystem: 'FamilyTreeEditor' },
    individuals: [],
    families: [],
  };
  const { doc, xref } = addIndividual(empty);
  return { doc, first: xref };
}
