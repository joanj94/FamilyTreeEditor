/**
 * Which row each person sits on, and who is drawn together.
 *
 * A port of `depths` and `blocks` from the companion pipeline. Both carry decisions that were
 * paid for in misread drawings, so the reasoning is carried over with the code:
 *
 * **Depth is the longest path from a root**, not the shortest, so a person sits below both parents
 * even where the two sides of the family run to different lengths.
 *
 * **Rows are settled, not read straight off that walk.** A couple share a row whichever way their
 * two lines run, and someone with no ancestry of their own sits directly above their children
 * rather than up among the founders. Both are pushes downward from the walk's answer, relaxed
 * together until nothing moves -- see `depths`.
 *
 * **A block is a person plus the spouses they bring in.** Blocks form a plain tree even though the
 * family graph does not, which is what makes a tidy-tree pack possible at all.
 *
 * **Only a spouse with no ancestry of their own joins their partner's block.** Someone with
 * parents must anchor their own or they could not hang from them: absorbing one into the other
 * made them vanish from the tree their own parents belong to.
 *
 * **A twice-married person is drawn between their spouses.** Ordered `[anchor, first, second]`,
 * the second union reached 296px back over the first spouse -- measured identically on all three
 * remarriages of the source chart, and the reason one family read as a ladder of parallel lines.
 * Between them, both unions join a neighbour and cross nothing.
 */
import { childrenOf, spousesOf, unionsOf, type Relations } from './relations.js';
import { olderFirst } from '../model/chronology.js';
import type { Xref } from '../model/types.js';

/**
 * The levelling below converges in two passes on the source chart. The cap only stops a
 * pathological input from spinning; it is not a tuning knob. Nobody can be deeper than the
 * number of people in the file, so a run still moving after that many passes is not going to
 * settle.
 */
const DEPTH_PASSES = 12;

/**
 * Which generation row each person sits on, before blocks are levelled.
 *
 * Rows are counted from 0 and row 0 is always occupied, so the generation a reader is shown is
 * simply the row plus one -- see `GENERATIONS_FROM` in the scene.
 */
export function depths(relations: Relations): ReadonlyMap<Xref, number> {
  const found = new Map<Xref, number>();

  const descend = (person: Xref, seen: Set<Xref>): number => {
    const memo = found.get(person);
    if (memo !== undefined) return memo;
    /* audit() rules cycles out; be safe anyway, since an imported file reaches here first. */
    if (seen.has(person)) return 0;
    seen.add(person);

    const family = relations.parentFamily.get(person);
    let deepest = 0;
    if (family !== undefined) {
      for (const spouse of spousesOf(relations, family)) {
        deepest = Math.max(deepest, descend(spouse, seen) + 1);
      }
    }
    found.set(person, deepest);
    return deepest;
  };

  for (const person of relations.persons) descend(person, new Set());

  /* Three rules, relaxed together until nothing moves. Every one of them pushes a person *down*
     and never up, so the settling is monotone: it either converges or runs out of passes, and it
     cannot cycle between two answers. */
  let moved = true;
  const sink = (person: Xref, row: number): void => {
    if (row <= (found.get(person) ?? 0)) return;
    found.set(person, row);
    moved = true;
  };
  const passes = Math.max(DEPTH_PASSES, relations.persons.length);
  for (let pass = 0; pass < passes && moved; pass += 1) {
    moved = false;
    for (const person of relations.persons) {
      // Below both parents, which is what `descend` seeded and what has to survive the rest.
      const born = relations.parentFamily.get(person);
      if (born !== undefined) {
        for (const parent of spousesOf(relations, born))
          sink(person, (found.get(parent) ?? 0) + 1);
      }

      /* Level with whoever they married. This used to be for the married-in only, and that is
         the case it was written for: someone with no ancestry starts at row 0 and has to be
         pulled down to their partner. But it holds for anyone -- two spouses whose lines run to
         different lengths were drawn a generation or more apart, joined by a connector crossing
         the rows between them, and a couple split across two generations is read as a wrong
         record rather than as a levelling that never happened. */
      for (const family of unionsOf(relations, person)) {
        for (const spouse of spousesOf(relations, family)) sink(person, found.get(spouse) ?? 0);
      }

      /* Someone with no ancestry of their own sits directly above their children, not at the top
         of the chart. Give a person on the fifth generation a father and he belongs on the
         fourth: anchored at row 0 instead, he would be drawn among the founders with a four-row
         connector down to the child he was just added for, and his child -- one below him by the
         rule above -- would be torn off the generation they were already on. */
      if (born === undefined) {
        let highest = Number.POSITIVE_INFINITY;
        for (const family of unionsOf(relations, person)) {
          for (const child of childrenOf(relations, family)) {
            highest = Math.min(highest, found.get(child) ?? 0);
          }
        }
        if (Number.isFinite(highest)) sink(person, highest - 1);
      }
    }
  }

  /* The top generation is row 0. Nothing above pushes every person off it -- whoever is highest
     has no parents, and the rule that would move them puts them one above their own children --
     but the chart numbers its generations from this row, so it is made true here rather than
     argued for at the place that counts them. */
  let highest = Number.POSITIVE_INFINITY;
  for (const row of found.values()) highest = Math.min(highest, row);
  if (Number.isFinite(highest) && highest !== 0) {
    for (const [person, row] of found) found.set(person, row - highest);
  }

  return found;
}

/** The block tree: who is drawn together, in what order, on which row. */
export interface Blocks {
  /** Depth-first walk order, which is what settles every tie below. */
  readonly order: ReadonlyMap<Xref, number>;
  /** Person to the block they belong to. */
  readonly of: ReadonlyMap<Xref, Xref>;
  /** Block to its people, in drawn order. */
  readonly members: ReadonlyMap<Xref, readonly Xref[]>;
  /** Block to the unions it owns -- the ones whose children hang from it. */
  readonly families: ReadonlyMap<Xref, readonly Xref[]>;
  /** Block to its row. */
  readonly depth: ReadonlyMap<Xref, number>;
  /** Person to their row, after each block was levelled onto one line. */
  readonly personDepth: ReadonlyMap<Xref, number>;
  readonly roots: readonly Xref[];
}

/**
 * Where the anchor stands among the spouses they brought in.
 *
 * With two or more, between them. A twice-married person beside both spouses forces the second
 * union to reach back over the first, and a long connector running under an unrelated box is
 * exactly what reads as a tangle.
 */
function drawnOrder(anchor: Xref, absorbed: readonly Xref[]): readonly Xref[] {
  if (absorbed.length >= 2) {
    const [first, ...rest] = absorbed;
    return first === undefined ? [anchor] : [first, anchor, ...rest];
  }
  return [anchor, ...absorbed];
}

/** Group each person with the spouses they bring in, and order the groups. */
export function buildBlocks(relations: Relations, depth: ReadonlyMap<Xref, number>): Blocks {
  const order = new Map<Xref, number>();
  const of = new Map<Xref, Xref>();
  const absorbed = new Map<Xref, Xref[]>();
  let counter = 0;

  const walk = (person: Xref): void => {
    if (order.has(person)) return;
    order.set(person, counter);
    counter += 1;
    if (!of.has(person)) of.set(person, person);
    if (!absorbed.has(person)) absorbed.set(person, []);

    for (const family of unionsOf(relations, person)) {
      for (const spouse of spousesOf(relations, family)) {
        // Only a spouse with no ancestry of their own joins; anyone with parents must anchor
        // their own block or they could not hang from them.
        if (!order.has(spouse) && !relations.parentFamily.has(spouse)) {
          order.set(spouse, counter);
          counter += 1;
          const anchor = of.get(person) ?? person;
          of.set(spouse, anchor);
          const group = absorbed.get(anchor);
          if (group === undefined) absorbed.set(anchor, [spouse]);
          else group.push(spouse);
        }
      }
      for (const child of childrenOf(relations, family)) walk(child);
    }
  };

  /* Seed on the most-married root first. Whoever is walked first anchors the block and absorbs
     the other, so seeding alphabetically let a spouse anchor a twice-married partner -- which
     puts the second union in a block of its own and reproduces exactly the reaching-over
     connector this ordering exists to prevent. */
  const older = olderFirst(relations.born);
  const seeds = relations.persons
    .filter((person) => !relations.parentFamily.has(person))
    .sort((left, right) => {
      const byUnions = unionsOf(relations, right).length - unionsOf(relations, left).length;
      if (byUnions !== 0) return byUnions;
      /* Then the elder, so a chart of equally-married founders reads oldest first. This decides
         nothing the crossing count has an opinion about -- it is reached only where the rule above
         is indifferent -- and the identifier stays underneath it for the undated, who would
         otherwise be left to whatever order the filter happened to produce. */
      const byBirth = older(left, right);
      if (byBirth !== 0) return byBirth;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  for (const person of seeds) walk(person);
  for (const person of relations.persons) walk(person);

  const members = new Map<Xref, readonly Xref[]>();
  for (const [anchor, kin] of absorbed) {
    if (of.get(anchor) === anchor) members.set(anchor, drawnOrder(anchor, kin));
  }

  /* Each union hangs its children off exactly one block -- the earlier of its spouses' -- so a
     couple drawn as two blocks does not lay its issue out twice. The other spouse still joins by
     a spouse link. */
  const owned = new Map<Xref, Xref[]>();
  for (const anchor of members.keys()) owned.set(anchor, []);
  for (const family of relations.families) {
    const pair = spousesOf(relations, family);
    if (pair.length === 0) continue;
    const first = pair.reduce((earliest, spouse) =>
      (order.get(spouse) ?? 0) < (order.get(earliest) ?? 0) ? spouse : earliest,
    );
    const anchor = of.get(first);
    if (anchor === undefined) continue;
    owned.get(anchor)?.push(family);
  }
  for (const list of owned.values()) {
    /* Ties are left to the sort's stability rather than broken by identifier, and the difference is
       visible: the unions of one twice-married person all share a first spouse, so `byOrder` says
       nothing about them and the identifier used to decide which marriage was drawn first. The
       list was built by walking `relations.families`, so stability instead keeps the order the
       document itself gives -- which `model/sort.ts` puts in the order the marriages happened. */
    list.sort((left, right) => {
      const leftFirst = spousesOf(relations, left)[0];
      const rightFirst = spousesOf(relations, right)[0];
      return (
        (leftFirst === undefined ? 0 : (order.get(leftFirst) ?? 0)) -
        (rightFirst === undefined ? 0 : (order.get(rightFirst) ?? 0))
      );
    });
  }

  /* Every member of a block shares a row, so the block sits on one line. The levelled depths go
     back as a new map rather than being written into the caller's: a spouse's row is a fact about
     the block they joined, and the ungrouped depth is still what `depths` means. */
  const rows = new Map<Xref, number>();
  const levelled = new Map<Xref, number>(depth);
  for (const [anchor, people] of members) {
    const row = people.reduce(
      (deepest, person) => Math.max(deepest, depth.get(person) ?? 0),
      0,
    );
    rows.set(anchor, row);
    for (const person of people) levelled.set(person, row);
  }

  const roots = [...members.keys()]
    .filter((anchor) => !relations.parentFamily.has(anchor))
    .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));

  return { order, of, members, families: owned, depth: rows, personDepth: levelled, roots };
}
