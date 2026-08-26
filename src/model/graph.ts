/**
 * The document read as a graph.
 *
 * Everything here is a query: nothing in this module returns a modified document. `audit()` and
 * the editing operations both need to ask the same questions -- who are this person's parents, is
 * that person already an ancestor of this one -- and asking them in two places is how the two
 * answers drift apart.
 *
 * **Parentage is read from both directions.** GEDCOM records the same fact twice: the family
 * lists `CHIL` and the person lists `FAMC`. A file can arrive with only one of the two, and
 * `audit()` reports that. Traversal must not depend on it having been repaired first -- a descent
 * cycle expressed through a one-sided link is still a cycle, and a walk that followed only one
 * side would fail to see it and hang.
 *
 * **`@VOID@` is a value, not an absence.** The standard's way of saying "deliberately no record"
 * is a pointer like any other, so it is filtered here rather than mistaken for a dangling one.
 */
import { VOID_POINTER } from './types.js';
import type { Family, GedcomDoc, Individual, Pointer, Xref } from './types.js';

/** Records by identifier, so a pointer costs a lookup rather than a scan. */
export interface GedcomIndex {
  readonly individuals: ReadonlyMap<Xref, Individual>;
  readonly families: ReadonlyMap<Xref, Family>;
  /**
   * Which families list each person as a child, in document order.
   *
   * Built once with the rest of the index because the alternative is a scan of every family per
   * question, and the questions are asked per person: `audit()` walks the parent edges of the
   * whole document on every edit, so a scan there made the work quadratic in the size of the file.
   * Measured before the change at 4,000 people and 800 families: 72 ms per `audit()`, against 6 ms
   * at 500 people -- the cost of one keystroke's worth of checking growing faster than the file.
   */
  readonly claimedAsChild: ReadonlyMap<Xref, readonly Xref[]>;
  readonly doc: GedcomDoc;
}

/** True where the pointer is the standard's deliberate reference to no record. */
export function isVoid(pointer: Pointer | undefined): boolean {
  return pointer === VOID_POINTER;
}

function isReference(pointer: Pointer | undefined): pointer is Pointer {
  return pointer !== undefined && !isVoid(pointer);
}

/**
 * Build the lookup.
 *
 * A duplicated identifier is a fault -- `audit()` reports it -- but the index still has to answer
 * lookups while the user is looking at the report. Keeping the first occurrence at least makes
 * every reading of a broken document the same reading.
 */
export function indexDoc(doc: GedcomDoc): GedcomIndex {
  const individuals = new Map<Xref, Individual>();
  for (const individual of doc.individuals) {
    if (!individuals.has(individual.xref)) individuals.set(individual.xref, individual);
  }
  const families = new Map<Xref, Family>();
  for (const family of doc.families) {
    if (!families.has(family.xref)) families.set(family.xref, family);
  }

  const claimedAsChild = new Map<Xref, Xref[]>();
  for (const family of doc.families) {
    // A family that lists the same child twice claims them once. `audit()` reports the duplicate
    // separately; it should not also make the person look like a child of two families.
    const seen = new Set<Xref>();
    for (const child of family.children ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      const claimed = claimedAsChild.get(child);
      if (claimed === undefined) claimedAsChild.set(child, [family.xref]);
      else claimed.push(family.xref);
    }
  }

  return { individuals, families, claimedAsChild, doc };
}

/** The partners a family names, in the standard's `HUSB`, `WIFE` order. */
export function partnersOf(family: Family): readonly Pointer[] {
  return [family.husband, family.wife].filter(isReference);
}

/** Everyone a family names: its partners, then its children. */
export function membersOf(family: Family): readonly Pointer[] {
  return [...partnersOf(family), ...(family.children ?? []).filter(isReference)];
}

/**
 * The families that claim this person as a child, from whichever side of the link records it.
 * The result is deduplicated and in document order.
 */
export function parentFamiliesOf(index: GedcomIndex, person: Xref): readonly Xref[] {
  // Families first, then the person's own links, which is the order the identifiers appear in the
  // file and therefore the order they are reported in.
  const found = new Set<Xref>(index.claimedAsChild.get(person) ?? []);
  for (const link of index.individuals.get(person)?.familiesAsChild ?? []) {
    if (isReference(link.xref) && index.families.has(link.xref)) found.add(link.xref);
  }
  return [...found];
}

/** This person's parents: the partners of every family that claims them as a child. */
export function parentsOf(index: GedcomIndex, person: Xref): readonly Xref[] {
  const parents = new Set<Xref>();
  for (const familyXref of parentFamiliesOf(index, person)) {
    const family = index.families.get(familyXref);
    if (family === undefined) continue;
    for (const partner of partnersOf(family)) parents.add(partner);
  }
  return [...parents];
}

/**
 * Everyone above this person in the graph.
 *
 * The visited set is what makes this safe on a document that already contains a cycle: an
 * imported file may well contain one, and a walk that assumed otherwise would not return. A
 * person who is their own ancestor therefore appears in their own result -- which is exactly the
 * signal `audit()` and the cycle-rejecting operations look for.
 */
export function ancestorsOf(index: GedcomIndex, person: Xref): ReadonlySet<Xref> {
  const ancestors = new Set<Xref>();
  const pending = [...parentsOf(index, person)];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || ancestors.has(current)) continue;
    ancestors.add(current);
    pending.push(...parentsOf(index, current));
  }
  return ancestors;
}

/** True where `ancestor` stands above `descendant` in the graph. */
export function isAncestorOf(index: GedcomIndex, ancestor: Xref, descendant: Xref): boolean {
  return ancestorsOf(index, descendant).has(ancestor);
}
