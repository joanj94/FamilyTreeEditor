/**
 * Document to coordinates. The whole of what the renderer needs, and nothing it decides.
 *
 * This is the seam the architecture is built around: a pure function, no DOM, no React, no
 * document mutation. That is what lets the geometric invariants -- a bar never reaching past its
 * children, a dot never leaving its couple, two families never interleaving on a row -- be
 * ordinary unit tests with no browser at all. Five layout faults were reported against the source
 * chart before that separation existed, and every one was first reported as a *data* error.
 *
 * **The layout is computed from the graph, never from a chart's coordinates.** Reusing those would
 * draw a perfect copy that proves nothing. Rows come from descent depth; columns come from a tidy
 * tree over blocks, packed in an order chosen to keep connectors from crossing.
 *
 * `blocks` is fold-independent, so a renderer that folds a union away re-packs from it rather than
 * asking for a different kind of layout.
 */
import { GEOMETRY, type Geometry } from './geometry.js';
import { buildBlocks, depths, type Blocks } from './blocks.js';
import { orderBlocks } from './ordering.js';
import { pack, placeUnions, spread, type Point, type UnionPlacement } from './pack.js';
import { readRelations, type Relations } from './relations.js';
import { personWidths, type Widths } from './widths.js';
import type { GedcomDoc, Xref } from '../model/types.js';

export { GEOMETRY, type Geometry } from './geometry.js';
export { type Point, type UnionPlacement } from './pack.js';
export { type Relations } from './relations.js';
export { type Blocks } from './blocks.js';
export { type Widths } from './widths.js';

/** A block as the renderer sees it: who is in it, what it owns, which row it is on. */
export interface BlockView {
  readonly id: Xref;
  readonly depth: number;
  readonly members: readonly Xref[];
  readonly families: readonly Xref[];
}

/** Everything needed to draw the chart. */
export interface Layout {
  readonly geometry: Geometry;
  readonly blocks: readonly BlockView[];
  readonly roots: readonly Xref[];
  /** Person to their row. */
  readonly depth: ReadonlyMap<Xref, number>;
  /** Person to the top-left corner of their box. */
  readonly positions: ReadonlyMap<Xref, Point>;
  /**
   * Person to the width of their box, which is the width of the name in it.
   *
   * Carried on the layout because the renderer must draw the box the pack made room for. A box
   * drawn at any other width would either clip its name or overlap its neighbour.
   */
  readonly widths: Widths;
  /** Person to the horizontal centre of their box, which is what connectors join. */
  readonly centres: ReadonlyMap<Xref, number>;
  readonly unions: ReadonlyMap<Xref, UnionPlacement>;
  /** The graph the layout was computed from, so a renderer need not rebuild it. */
  readonly relations: Relations;
  /** The block tree, which is fold-independent and is what a re-pack starts from. */
  readonly groups: Blocks;
}

export interface LayoutOptions {
  /** Unions whose descent is folded away. They keep their dot and lose their bar. */
  readonly collapsed?: ReadonlySet<Xref>;
}

/** Lay a document out. Pure: the document is read and nothing else is touched. */
export function computeLayout(doc: GedcomDoc, options: LayoutOptions = {}): Layout {
  const collapsed = options.collapsed ?? new Set<Xref>();
  const relations = readRelations(doc);
  const groups = buildBlocks(relations, depths(relations));
  const depth = groups.personDepth;
  /* Measured before anything is placed: a box is as wide as its name, so every width below --
     a block's, a row's, the whole drawing's -- is built up from these. */
  const widths = personWidths(doc);
  /* Who sits next to whom is chosen before anything is placed. The pack's arithmetic is
     untouched by it: it centres and pushes right exactly as before, over a different order. */
  const packing = pack(
    groups,
    relations,
    collapsed,
    orderBlocks(groups, relations, collapsed),
    widths,
  );
  const { visible } = packing;
  const { positions, centres } = spread(groups, packing, widths);

  const blocks = [...groups.members.keys()]
    .filter((anchor) => visible.has(anchor))
    .sort((first, second) => (groups.order.get(first) ?? 0) - (groups.order.get(second) ?? 0))
    .map((anchor) => ({
      id: anchor,
      depth: groups.depth.get(anchor) ?? 0,
      members: groups.members.get(anchor) ?? [],
      families: groups.families.get(anchor) ?? [],
    }));

  const personDepth = new Map<Xref, number>();
  for (const person of relations.persons) personDepth.set(person, depth.get(person) ?? 0);

  return {
    geometry: GEOMETRY,
    blocks,
    roots: groups.roots,
    depth: personDepth,
    positions,
    widths,
    centres,
    unions: placeUnions(relations, depth, centres, collapsed),
    relations,
    groups,
  };
}
