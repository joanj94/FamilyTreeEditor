/**
 * Where the blocks go, and where each union hangs.
 *
 * A port of `pack`, `ordinal` and `place_unions` from the companion pipeline.
 *
 * **The pack is a tidy tree, bottom-up.** Lay out a block's children, then centre the block over
 * them. Where centring would collide with what is already placed, the whole child subtree moves
 * right rather than the parent going off-centre -- `cursor`, the next free x on each row, is what
 * makes subtree overlap impossible.
 *
 * **A union dot sits between its own spouses and is never pushed off them.** An earlier version
 * clamped the dot into the span of its children, which put it outside the couple entirely and made
 * the sibling bar reach back across whatever lay between. Instead the dot stays put and the stem
 * doglegs into the children's span before dropping to the bar -- a drop, a short horizontal, then
 * the rise, which is what the source chart draws.
 *
 * **Each union gets its own horizontal lane.** A spouse link runs down from the box and then
 * sideways to the dot, so two unions sharing a row and standing side by side drew one unbroken
 * stroke: it read as a single union joining eight people who were in four separate couples.
 */
import { GEOMETRY } from './geometry.js';
import { childrenOf, spousesOf, unionsOf, type Relations } from './relations.js';
import type { Blocks } from './blocks.js';
import type { Xref } from '../model/types.js';

/** Where a union's dot sits, and how its descent is routed from there. */
export interface UnionPlacement {
  /** The couple's own midpoint. */
  readonly x: number;
  readonly y: number;
  /** Which horizontal lane this union's connector runs in. */
  readonly lane: number;
  /** Which of a parent's unions this is, or 0 where they married once. */
  readonly ordinal?: number;
  /** The sibling bar. Absent where the union has no drawn children. */
  readonly barY?: number;
  readonly barFrom?: number;
  readonly barTo?: number;
  /** Where the stem doglegs across before dropping to the bar. */
  readonly stemY?: number;
  readonly stemX?: number;
  readonly children?: readonly Xref[];
}

/** Where the blocks ended up, and which of them were drawn at all. */
export interface Packing {
  /** Block to the x of its left edge. */
  readonly left: ReadonlyMap<Xref, number>;
  /** The blocks that were placed. A block under a folded union is not among them. */
  readonly visible: ReadonlySet<Xref>;
}

/**
 * The left edge of every block, in layout coordinates.
 *
 * A folded union is not traversed, so its descendants are never placed and the tree closes up
 * around what is left. That is the whole of what folding does to the geometry: everything else --
 * the dot staying put, the bar disappearing -- falls out of a person having no position.
 */
export function pack(
  blocks: Blocks,
  relations: Relations,
  collapsed: ReadonlySet<Xref> = new Set(),
): Packing {
  const left = new Map<Xref, number>();
  const visible = new Set<Xref>();
  const cursor = new Map<number, number>();

  const width = (anchor: Xref): number => {
    const count = (blocks.members.get(anchor) ?? []).length;
    return count * GEOMETRY.nodeW + (count - 1) * GEOMETRY.gapX;
  };

  const kidsOf = (anchor: Xref): readonly Xref[] =>
    (blocks.families.get(anchor) ?? [])
      .filter((family) => !collapsed.has(family))
      .flatMap((family) => childrenOf(relations, family));

  const shift = (anchor: Xref, dx: number): void => {
    left.set(anchor, (left.get(anchor) ?? 0) + dx);
    for (const child of kidsOf(anchor)) shift(child, dx);
  };

  const place = (anchor: Xref): void => {
    const row = blocks.depth.get(anchor) ?? 0;
    const kids = kidsOf(anchor);
    for (const child of kids) place(child);

    const own = width(anchor);
    const floor = cursor.get(row) ?? 0;
    let want = floor;

    const first = kids[0];
    const last = kids[kids.length - 1];
    if (first !== undefined && last !== undefined) {
      const centre = ((left.get(first) ?? 0) + (left.get(last) ?? 0) + width(last)) / 2;
      want = centre - own / 2;
      if (want < floor) {
        const dx = floor - want;
        for (const child of kids) shift(child, dx);
        for (const [below, at] of [...cursor]) {
          if (below > row) cursor.set(below, at + dx);
        }
        want = floor;
      }
    }

    left.set(anchor, want);
    visible.add(anchor);
    cursor.set(row, want + own + GEOMETRY.blockGap);
  };

  for (const root of blocks.roots) place(root);
  return { left, visible };
}

/**
 * Which of a parent's unions this is, counting the way the chart does.
 *
 * The chart prints (1), (2) beside each child's descent and prints nothing where the parent
 * married once. Without it, a parent with two unions has two sibling bars and nothing says which
 * children came from which. It is derived from position among that parent's unions, never from
 * anything written in the file.
 */
export function ordinal(family: Xref, relations: Relations): number {
  let mark = 0;
  for (const spouse of spousesOf(relations, family)) {
    const all = unionsOf(relations, spouse);
    if (all.length > 1) mark = all.indexOf(family) + 1;
  }
  return mark;
}

interface Reach {
  readonly family: Xref;
  readonly x: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Give two dots on the same row room to read as two.
 *
 * A dot sits at the midpoint of its own spouses. Two unions whose couples are centred alike --
 * one wide, one narrow -- therefore land within a few pixels of each other, and the lane mechanism
 * then separates them by one lane's height, which is a stack rather than a gap. Measured on the
 * test chart: 10.5px apart, and it read as a single joint wearing two fold boxes.
 *
 * A single left-to-right sweep, pushing rightward only. That is what keeps it stable: a pass that
 * pushed both ways would move a dot into the one before it and need another pass to undo it.
 *
 * **A dot is never pushed past the spouse it belongs to.** That rule predates this function -- an
 * earlier version let a dot drift off its own couple and the connector stopped meaning anything --
 * so the shift is clamped to `to`, and a union that cannot be given room keeps its place. Nothing
 * is lost by that: the lanes are still there, and they are what separates the ones that cannot
 * move.
 */
function separate(unions: readonly Reach[]): readonly Reach[] {
  const byX = [...unions].sort((left, right) => {
    if (left.x !== right.x) return left.x - right.x;
    return left.family < right.family ? -1 : left.family > right.family ? 1 : 0;
  });

  let previous = Number.NEGATIVE_INFINITY;
  return byX.map((union) => {
    const wanted = Math.max(union.x, previous + GEOMETRY.minUnionGap);
    const x = Math.min(wanted, union.to);
    previous = x;
    return { ...union, x };
  });
}

/**
 * Put each union in the gap below its spouses, and route its descent.
 *
 * A union in `collapsed` keeps its dot and loses its bar: folding has to close the tree up, not
 * leave a stub hanging into empty space.
 */
export function placeUnions(
  relations: Relations,
  depth: ReadonlyMap<Xref, number>,
  centre: ReadonlyMap<Xref, number>,
  collapsed: ReadonlySet<Xref> = new Set(),
): ReadonlyMap<Xref, UnionPlacement> {
  const ranked = new Map<number, Reach[]>();
  for (const family of relations.families) {
    const pair = spousesOf(relations, family);
    if (pair.length === 0 || !pair.every((spouse) => centre.has(spouse))) continue;

    const row = pair.reduce((deepest, spouse) => Math.max(deepest, depth.get(spouse) ?? 0), 0);
    const xs = pair.map((spouse) => centre.get(spouse) ?? 0).sort((a, b) => a - b);
    const from = xs[0] ?? 0;
    const to = xs[xs.length - 1] ?? 0;
    const reach: Reach = { family, x: (from + to) / 2, from, to };
    const onRow = ranked.get(row);
    if (onRow === undefined) ranked.set(row, [reach]);
    else onRow.push(reach);
  }

  const placed = new Map<Xref, UnionPlacement>();
  for (const [row, unions] of ranked) {
    const laneEnd: number[] = [];
    const spaced = separate(unions);
    const ordered = [...spaced].sort((left, right) => {
      if (left.from !== right.from) return left.from - right.from;
      return left.family < right.family ? -1 : left.family > right.family ? 1 : 0;
    });

    for (const union of ordered) {
      let lane = laneEnd.findIndex((end) => end < union.from - GEOMETRY.laneSlop);
      if (lane === -1) {
        if (laneEnd.length < GEOMETRY.lanes) {
          laneEnd.push(0);
          lane = laneEnd.length - 1;
        } else {
          lane = GEOMETRY.lanes - 1;
        }
      }
      laneEnd[lane] = union.to;

      const y =
        row * GEOMETRY.rowH + GEOMETRY.nodeH + GEOMETRY.unionDrop + lane * GEOMETRY.laneH;
      const kids = collapsed.has(union.family) ? [] : childrenOf(relations, union.family);
      const drawn = kids.filter((child) => centre.has(child));

      if (drawn.length === 0) {
        placed.set(union.family, { x: union.x, y, lane });
        continue;
      }

      const mark = ordinal(union.family, relations);
      /* Lifting the bar off the child row is what keeps it clear of the boxes below; the floor is
         what keeps it clear of the fold box hanging under its own dot. Taken from the child row
         alone, the two landed at exactly the same y on every remarriage on the source chart -- a
         measured gap of 0px, and the knot the drawing was reported for. */
      const childRow = drawn.reduce(
        (highest, child) => Math.min(highest, depth.get(child) ?? 0),
        Number.POSITIVE_INFINITY,
      );
      const bar = Math.max(
        childRow * GEOMETRY.rowH -
          GEOMETRY.barLift -
          Math.max(0, mark - 1) * GEOMETRY.ordinalStagger,
        y + GEOMETRY.minBarBelowDot,
      );
      const xs = drawn.map((child) => centre.get(child) ?? 0);
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);

      placed.set(union.family, {
        x: union.x,
        y,
        lane,
        ordinal: mark,
        barY: bar,
        barFrom: lo,
        barTo: hi,
        stemY: bar - GEOMETRY.stemDogleg,
        /* The stem doglegs into the children's span rather than the dot being dragged out of its
           couple to meet them. The bar then never reaches past the children it joins. */
        stemX: Math.min(Math.max(union.x, lo), hi),
        children: drawn,
      });
    }
  }
  return placed;
}
