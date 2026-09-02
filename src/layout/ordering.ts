/**
 * Who sits next to whom, chosen so that fewer connectors cross.
 *
 * The chart was reported as messy. The mess is crossings, and they come from one place: a couple
 * whose partners both have parents cannot share a block -- each must anchor its own or it could
 * not hang from its own family -- and the packer, knowing nothing of the marriage, is then free to
 * put strangers between them. Their connector runs the width of the row and crosses everything
 * dropping out of the boxes in between. Seven of the seven crossings on the fixture chart were
 * that one shape.
 *
 * **Nothing here moves a box.** The pack still does all the placing; this only chooses the order
 * it places in, which is the seam `BlockOrder` opened. A bug here can make the chart uglier. It
 * cannot make it wrong.
 *
 * **Zero is not promised.** A family graph is not a tree -- a cousin marriage forces a crossing in
 * any layered layout, and minimising crossings is NP-hard besides. So this is a heuristic with a
 * guarantee attached instead: it returns the best order it found, and the order it started from is
 * one of the candidates, so the answer is never worse than doing nothing.
 *
 * The method is the one Sugiyama layered drawing has used since 1981 -- sort each list by the
 * average position of what its entries connect to, then hill-climb on adjacent swaps -- with the
 * crossing count itself as the objective, so the search optimises the thing that was reported
 * rather than a proxy for it.
 */
import { countCrossings } from './crossings.js';
import { childBlocks, pack, placeUnions, spread, type BlockOrder } from './pack.js';
import { spousesOf, unionsOf, type Relations } from './relations.js';
import { olderFirst } from '../model/chronology.js';
import type { Blocks } from './blocks.js';
import type { Xref } from '../model/types.js';

/**
 * How big a chart each half of the search is allowed on.
 *
 * The layout is recomputed on every fold and every edit, so this sits on the interactive path and
 * has to be bounded. The two halves cost very differently: the sweep is a handful of re-packs
 * whatever the size, while the hill-climb tries a candidate per adjacent pair and is therefore
 * quadratic in the number of blocks.
 *
 * Measured on a deliberately adversarial tree -- every couple's partners both have parents, and
 * none of them start as neighbours -- the full search took 0.2s at 192 blocks, 0.75s at 384 and
 * 4.3s at 768. So the hill-climb stops at a size where its worst case stays under about half a
 * second, and the sweep, which is cheap, carries on well past it. Beyond both, the chart is drawn
 * in the order the block tree gave it: a drawing that comes up is worth more than a tidier one
 * that does not.
 */
export const ORDER_LIMITS = {
  /** Above this many blocks nothing is reordered at all. */
  sweep: 4000,
  /** Above this many blocks the barycentre sweep runs and the hill-climb is skipped. */
  climb: 300,
} as const;

/** How big a chart each half of the search may run on. */
export interface OrderLimits {
  readonly sweep?: number;
  readonly climb?: number;
}

/** How many barycentre sweeps before giving up on a fixed point. */
const SWEEPS = 8;

/** How many hill-climbing rounds over the adjacent pairs. */
const ROUNDS = 4;

/** One candidate order: the roots left to right, and each block's children left to right. */
interface Arrangement {
  readonly roots: readonly Xref[];
  readonly children: ReadonlyMap<Xref, readonly Xref[]>;
}

/** A candidate, packed and counted. */
interface Trial {
  readonly arrangement: Arrangement;
  readonly crossings: number;
  /** Person to the centre of their box under this arrangement, which is what a sweep reads. */
  readonly centres: ReadonlyMap<Xref, number>;
}

function orderFrom(arrangement: Arrangement): BlockOrder {
  return {
    roots: arrangement.roots,
    childrenOf: (anchor) => arrangement.children.get(anchor) ?? [],
  };
}

/** The order the block tree itself gives, which is both the starting point and the fallback. */
function asBuilt(
  blocks: Blocks,
  relations: Relations,
  collapsed: ReadonlySet<Xref>,
): Arrangement {
  const children = new Map<Xref, readonly Xref[]>();
  for (const anchor of blocks.members.keys()) {
    children.set(anchor, childBlocks(blocks, relations, anchor, collapsed));
  }
  return { roots: blocks.roots, children };
}

/** Pack a candidate and count what it costs. The only place a candidate is ever judged. */
function measure(
  blocks: Blocks,
  relations: Relations,
  collapsed: ReadonlySet<Xref>,
  arrangement: Arrangement,
): Trial {
  const packing = pack(blocks, relations, collapsed, orderFrom(arrangement));
  const { positions, centres } = spread(blocks, packing);
  const unions = placeUnions(relations, blocks.personDepth, centres, collapsed);
  return {
    arrangement,
    crossings: countCrossings({ relations, positions, centres, unions }),
    centres,
  };
}

/** The blocks this one is joined to by marriage, which are the only cross-tree ties there are. */
function matesOf(blocks: Blocks, relations: Relations, anchor: Xref): readonly Xref[] {
  const mates: Xref[] = [];
  for (const person of blocks.members.get(anchor) ?? []) {
    for (const family of unionsOf(relations, person)) {
      for (const spouse of spousesOf(relations, family)) {
        if (spouse === person) continue;
        const other = blocks.of.get(spouse);
        /* A spouse inside this same block is the couple already drawn side by side, which is the
           case this whole module exists to reproduce for the couples that cannot be. */
        if (other !== undefined && other !== anchor) mates.push(other);
      }
    }
  }
  return mates;
}

/**
 * Sort every list by where the marriages in it point.
 *
 * A block goes near the average x of the blocks it marries into; one that marries nowhere stays
 * where it is, which is what keeps a sweep from shuffling an already tidy family for nothing.
 * Ties fall back to current position, then to birth, then to xref -- so a sweep that has no
 * opinion leaves the elder on the left, and the answer still cannot depend on the order a map
 * happened to iterate in.
 */
function swept(
  blocks: Blocks,
  relations: Relations,
  arrangement: Arrangement,
  centres: ReadonlyMap<Xref, number>,
): Arrangement {
  const here = new Map<Xref, number>();
  const at = (anchor: Xref): number => {
    const known = here.get(anchor);
    if (known !== undefined) return known;
    const xs = (blocks.members.get(anchor) ?? [])
      .map((person) => centres.get(person))
      .filter((x): x is number => x !== undefined);
    /* A block under a folded union is never drawn, so it has no position to sort by. Zero is as
       good as anything: its list is not drawn either, and the xref tie-break keeps it settled. */
    const found = xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;
    here.set(anchor, found);
    return found;
  };

  const pull = new Map<Xref, number>();
  const towards = (anchor: Xref): number => {
    const known = pull.get(anchor);
    if (known !== undefined) return known;
    const mates = matesOf(blocks, relations, anchor);
    const found =
      mates.length === 0
        ? at(anchor)
        : mates.reduce((sum, mate) => sum + at(mate), 0) / mates.length;
    pull.set(anchor, found);
    return found;
  };

  const older = olderFirst(relations.born);
  const sorted = (list: readonly Xref[]): readonly Xref[] =>
    [...list].sort(
      (left, right) =>
        towards(left) - towards(right) ||
        at(left) - at(right) ||
        older(left, right) ||
        (left < right ? -1 : left > right ? 1 : 0),
    );

  const children = new Map<Xref, readonly Xref[]>();
  for (const [anchor, list] of arrangement.children) children.set(anchor, sorted(list));
  return { roots: sorted(arrangement.roots), children };
}

/** Whether two arrangements are the same list of lists, which is how a fixed point is spotted. */
function settled(left: Arrangement, right: Arrangement): boolean {
  if (left.roots.join() !== right.roots.join()) return false;
  for (const [anchor, list] of left.children) {
    if (list.join() !== (right.children.get(anchor) ?? []).join()) return false;
  }
  return true;
}

function swapped(list: readonly Xref[], index: number): readonly Xref[] {
  const next = [...list];
  const left = next[index];
  const right = next[index + 1];
  if (left === undefined || right === undefined) return list;
  next[index] = right;
  next[index + 1] = left;
  return next;
}

/**
 * Hill-climb on adjacent swaps, keeping one only where the count actually drops.
 *
 * The sweep above is a good guess and nothing more -- it reasons about average positions, which is
 * a proxy. This reasons about the count itself: swap two neighbours, re-pack, re-count, and keep
 * the swap only if the chart genuinely improved. It is slow and it is the only part that cannot
 * make things worse, which together are why it goes last and why the sweep goes first.
 *
 * The lists are visited in block order rather than in map order, so the same document is always
 * searched in the same sequence and always arrives at the same answer.
 */
function climbed(
  blocks: Blocks,
  relations: Relations,
  collapsed: ReadonlySet<Xref>,
  start: Trial,
): Trial {
  const holders: (Xref | undefined)[] = [
    undefined,
    ...[...blocks.members.keys()].sort(
      (left, right) => (blocks.order.get(left) ?? 0) - (blocks.order.get(right) ?? 0),
    ),
  ];

  let best = start;
  for (let round = 0; round < ROUNDS && best.crossings > 0; round += 1) {
    let moved = false;
    for (const holder of holders) {
      const listOf = (arrangement: Arrangement): readonly Xref[] =>
        holder === undefined ? arrangement.roots : (arrangement.children.get(holder) ?? []);
      const length = listOf(best.arrangement).length;

      for (let index = 0; index + 1 < length; index += 1) {
        const list = swapped(listOf(best.arrangement), index);
        const children = new Map(best.arrangement.children);
        if (holder !== undefined) children.set(holder, list);
        const candidate: Arrangement = {
          roots: holder === undefined ? list : best.arrangement.roots,
          children,
        };
        const trial = measure(blocks, relations, collapsed, candidate);
        if (trial.crossings < best.crossings) {
          best = trial;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return best;
}

/**
 * The order to pack in: a barycentre sweep to a fixed point, then a hill-climb on the count.
 *
 * The order the block tree gave is the first candidate and is kept unless something beats it, so
 * the worst this can do is nothing at all.
 */
export function orderBlocks(
  blocks: Blocks,
  relations: Relations,
  collapsed: ReadonlySet<Xref> = new Set(),
  limits: OrderLimits = {},
): BlockOrder {
  const identity = asBuilt(blocks, relations, collapsed);
  const size = blocks.members.size;
  if (size > (limits.sweep ?? ORDER_LIMITS.sweep)) return orderFrom(identity);

  let current = measure(blocks, relations, collapsed, identity);
  let best = current;

  for (let sweep = 0; sweep < SWEEPS && best.crossings > 0; sweep += 1) {
    const next = measure(
      blocks,
      relations,
      collapsed,
      swept(blocks, relations, current.arrangement, current.centres),
    );
    if (settled(next.arrangement, current.arrangement)) break;
    current = next;
    if (next.crossings < best.crossings) best = next;
  }

  if (best.crossings > 0 && size <= (limits.climb ?? ORDER_LIMITS.climb)) {
    best = climbed(blocks, relations, collapsed, best);
  }
  return orderFrom(best.arrangement);
}
