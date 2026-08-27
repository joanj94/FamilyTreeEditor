/**
 * One person's line: everyone above them, everyone below them, and the unions in between.
 *
 * A reader looking at a wide chart cannot tell, at a glance, which of the two hundred boxes on it
 * are this person's own blood and which belong to a family that married in three generations ago.
 * Tracing it by eye means following connectors across the whole drawing and losing the thread at
 * every junction. This answers the question outright, and `Chart` draws the answer in bold.
 *
 * **The walk goes two ways and they are not symmetrical, on purpose.**
 *
 * Upward it follows parent families only. Every partner of a family that claims you as a child is
 * an ancestor -- a step-parent as much as a birth parent, because the chart draws no distinction
 * and the record may not record one -- and the walk continues from each of them. It does *not*
 * follow an ancestor's other marriages: a great-grandfather's second wife is not in your line, and
 * a walk that took her would drag in her whole family and end up bolding most of the chart.
 *
 * Downward it follows the unions a person is a partner in, taking their children and the partner
 * each of them married. The partner is included but never walked through, so a daughter-in-law is
 * lit -- she is plainly one of the linked -- while her parents and siblings are not.
 *
 * **Both walks carry a visited set**, for the reason `ancestorsOf` does: an imported file may
 * contain a descent cycle, `audit()` reports it, and nothing here may hang while the user is
 * reading that report.
 *
 * Pure, like everything in `model/`: it returns two sets of identifiers and knows nothing about
 * how they are drawn.
 */
import { isVoid, parentFamiliesOf, partnersOf } from './graph.js';
import type { GedcomIndex } from './graph.js';
import type { Xref } from './types.js';

/** Who is in the line, and which unions it passes through. */
export interface Lineage {
  /** The person themselves, their ancestors, their descendants, and those descendants' partners. */
  readonly people: ReadonlySet<Xref>;
  /** Every union the line runs through, so the dots and the connectors can be drawn with it. */
  readonly families: ReadonlySet<Xref>;
}

/**
 * The two lookups the downward walk needs, read from both sides of every link.
 *
 * GEDCOM records each of these facts twice -- a family lists `CHIL` and `HUSB`/`WIFE`, a person
 * lists `FAMC` and `FAMS` -- and a file can arrive with only one of the pair. `graph.ts` reads
 * parentage from both directions for exactly that reason; a walk down the tree has to do the same,
 * or a half-recorded link quietly cuts a branch off the line.
 *
 * Built once per call rather than per person: the alternative is a scan of every family for every
 * descendant, which is the quadratic shape `claimedAsChild` exists to avoid.
 */
interface Ties {
  /** Family to the people it claims as children. */
  readonly childrenOf: ReadonlyMap<Xref, readonly Xref[]>;
  /** Person to the families they are a partner in. */
  readonly unionsOf: ReadonlyMap<Xref, readonly Xref[]>;
}

function add(map: Map<Xref, Xref[]>, key: Xref, value: Xref): void {
  const held = map.get(key);
  if (held === undefined) map.set(key, [value]);
  else if (!held.includes(value)) held.push(value);
}

function tiesOf(index: GedcomIndex): Ties {
  const childrenOf = new Map<Xref, Xref[]>();
  const unionsOf = new Map<Xref, Xref[]>();

  for (const family of index.families.values()) {
    for (const child of family.children ?? []) {
      if (!isVoid(child) && index.individuals.has(child)) add(childrenOf, family.xref, child);
    }
    for (const partner of partnersOf(family)) {
      if (index.individuals.has(partner)) add(unionsOf, partner, family.xref);
    }
  }
  for (const person of index.individuals.values()) {
    for (const link of person.familiesAsChild ?? []) {
      if (!isVoid(link.xref) && index.families.has(link.xref)) {
        add(childrenOf, link.xref, person.xref);
      }
    }
    for (const link of person.familiesAsSpouse ?? []) {
      if (!isVoid(link.xref) && index.families.has(link.xref)) {
        add(unionsOf, person.xref, link.xref);
      }
    }
  }

  return { childrenOf, unionsOf };
}

/**
 * The line through one person.
 *
 * An identifier the document does not contain gets an empty line rather than a thrown error: the
 * selection outlives the record it names for as long as it takes a delete to re-render, and a
 * chart that threw in that window would take the editor down over a transient.
 */
export function lineageOf(index: GedcomIndex, person: Xref): Lineage {
  const people = new Set<Xref>();
  const families = new Set<Xref>();
  if (!index.individuals.has(person)) return { people, families };
  people.add(person);

  // Up, parent family by parent family. Both partners of each are ancestors, and the walk goes on
  // from each of them; their other marriages are somebody else's line.
  const climbed = new Set<Xref>();
  const rising: Xref[] = [person];
  while (rising.length > 0) {
    const at = rising.pop();
    if (at === undefined || climbed.has(at)) continue;
    climbed.add(at);
    for (const familyXref of parentFamiliesOf(index, at)) {
      families.add(familyXref);
      const family = index.families.get(familyXref);
      if (family === undefined) continue;
      for (const parent of partnersOf(family)) {
        if (!index.individuals.has(parent)) continue;
        people.add(parent);
        rising.push(parent);
      }
    }
  }

  // Down, union by union. The partner of each union is lit but not walked through -- see the note
  // at the top of the file about why the two directions differ.
  const { childrenOf, unionsOf } = tiesOf(index);
  const descended = new Set<Xref>();
  const falling: Xref[] = [person];
  while (falling.length > 0) {
    const at = falling.pop();
    if (at === undefined || descended.has(at)) continue;
    descended.add(at);
    for (const familyXref of unionsOf.get(at) ?? []) {
      families.add(familyXref);
      const family = index.families.get(familyXref);
      if (family !== undefined) {
        for (const partner of partnersOf(family)) {
          if (index.individuals.has(partner)) people.add(partner);
        }
      }
      for (const child of childrenOf.get(familyXref) ?? []) {
        people.add(child);
        falling.push(child);
      }
    }
  }

  return { people, families };
}
