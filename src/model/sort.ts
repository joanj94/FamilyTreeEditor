/**
 * Putting the document in chronological order.
 *
 * **Nothing here changes what the document says.** Every list this touches is a list whose order
 * GEDCOM attaches no meaning to -- the `CHIL` lines of a family, the order records appear in the
 * file -- so reordering them says exactly what the file said before, in the sequence a reader
 * expects. No pointer is rewritten, no record is added or dropped, and both halves of every link
 * still name each other, which is why this needs none of `ops.ts`'s repair machinery and cannot
 * fail an audit the document was already passing.
 *
 * **Order is the whole mechanism, so it is worth saying where it lands.** The layout reads
 * siblings straight off `FAM.CHIL` (`relations.ts` builds `children` from it, and `pack.ts` lays a
 * block's issue out in that order), reads its walk order off `doc.individuals`, and reads a
 * person's remarriage order off the sequence `doc.families` is iterated in. Those three lists are
 * therefore exactly the three this sorts, and between them they are every place a date can reach
 * the drawing.
 *
 * **The crossing search still has the last word.** `layout/ordering.ts` may reorder blocks to
 * reduce crossings, and it is right to: a chart that reads chronologically but runs its connectors
 * through each other is worse than one that does not. What this guarantees is the starting point
 * and the tie-break -- where the crossing count is indifferent, the older person is drawn first.
 *
 * **Sorting twice is sorting once.** The comparator is total and the sorts are stable, so a second
 * run changes nothing. That matters because this is offered as a button: a user who presses it
 * twice must not get a different chart the second time.
 */
import { birthIndex, compareTimes, timeOf, type TimeKey } from './chronology.js';
import type { Family, GedcomDoc, Xref } from './types.js';

/**
 * What a sort did, for the user rather than for a log.
 *
 * `undated` is the number worth showing: it counts the people this could say nothing about, and is
 * therefore the honest measure of how much of the chart actually got sorted. Someone with two
 * hundred undated people should be told, not left wondering why half the tree did not move.
 */
export interface SortReport {
  readonly doc: GedcomDoc;
  /** How many families had their list of children reordered. */
  readonly familiesReordered: number;
  /** How many people carry no birth date this could read. */
  readonly undated: number;
  /** False where the document was already in order, so a caller can decline to record a no-op. */
  readonly changed: boolean;
}

/** The earliest of a set of people's births, or undefined where none of them has one. */
function earliestBirth(
  people: readonly Xref[],
  born: ReadonlyMap<Xref, TimeKey>,
): TimeKey | undefined {
  return people
    .map((xref) => born.get(xref))
    .reduce<TimeKey | undefined>(
      (best, key) =>
        key === undefined || (best !== undefined && compareTimes(key, best) >= 0) ? best : key,
      undefined,
    );
}

/**
 * When a union happened, as far as its record allows.
 *
 * The marriage is asked first because it is the event the union *is*. Where that is undated the
 * earliest child dates it nearly as well -- a couple's first child is rarely far from their
 * marriage -- and the partners' own births are the last resort, being a fact about them rather
 * than about the union.
 *
 * Ordering unions matters for one thing in particular: a person married twice has their families
 * drawn in the order `doc.families` lists them, so a remarriage that happened to be recorded first
 * would otherwise be drawn as though it came first.
 */
function unionTime(family: Family, born: ReadonlyMap<Xref, TimeKey>): TimeKey | undefined {
  for (const event of family.events ?? []) {
    if (event.tag !== 'MARR') continue;
    const key = timeOf(event.date);
    if (key !== undefined) return key;
  }

  const partners = [family.husband, family.wife].filter(
    (xref): xref is Xref => xref !== undefined,
  );
  return earliestBirth(family.children ?? [], born) ?? earliestBirth(partners, born);
}

/** Whether two lists hold the same things in the same places. */
function same<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, at) => item === right[at]);
}

/**
 * Order the document by birth: siblings, people, and unions.
 *
 * Every sort here is `Array.prototype.sort`, which the language has guaranteed stable since
 * ES2019. That is not an implementation detail but the mechanism by which undated records keep
 * their place: the comparator returns zero for two of them, so their relative order is the one the
 * document already had rather than one this function invented.
 */
export function sortByBirth(doc: GedcomDoc): SortReport {
  const born = birthIndex(doc);
  const byBirth = (left: Xref, right: Xref): number =>
    compareTimes(born.get(left), born.get(right));

  let familiesReordered = 0;
  const resorted = doc.families.map((family) => {
    const children = family.children;
    /* A list of one cannot be out of order, and rebuilding the record for nothing would spend the
       structural sharing that makes an undo stack of whole documents affordable. */
    if (children === undefined || children.length < 2) return family;
    const sorted = [...children].sort(byBirth);
    if (same(sorted, children)) return family;
    familiesReordered += 1;
    return { ...family, children: sorted };
  });

  const individuals = [...doc.individuals].sort((left, right) =>
    byBirth(left.xref, right.xref),
  );

  const married = new Map<Xref, TimeKey>();
  for (const family of resorted) {
    const key = unionTime(family, born);
    if (key !== undefined) married.set(family.xref, key);
  }
  const families = [...resorted].sort((left, right) =>
    compareTimes(married.get(left.xref), married.get(right.xref)),
  );

  const changed =
    familiesReordered > 0 ||
    !same(individuals, doc.individuals) ||
    !same(families, doc.families);

  return {
    doc: changed ? { ...doc, individuals, families } : doc,
    familiesReordered,
    undated: doc.individuals.length - born.size,
    changed,
  };
}
