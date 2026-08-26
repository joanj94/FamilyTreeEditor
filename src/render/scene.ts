/**
 * The chart as a list of things to draw.
 *
 * Between the layout and React, and pure like the layout is. The renderer's decisions -- which
 * connector runs where, what a box says, how much a folded union is hiding -- are made here, where
 * they can be asserted without mounting anything. What is left for the component is turning this
 * list into elements, which is the part React is actually for.
 *
 * A port of `drawLinks` and `drawUnions` from the companion viewer, minus the DOM.
 */
import { GEOMETRY, type Layout } from '../layout/layout.js';
import { fitText } from '../layout/text.js';
import { widthOf } from '../layout/widths.js';
import { childrenOf, spousesOf } from '../layout/relations.js';
import { ortho } from './ortho.js';
import { displayName, displayYears } from '../model/labels.js';
import type { GedcomDoc, Sex, Xref } from '../model/types.js';

/* The chart's reading of a record is shared with the layout, which sizes the boxes from it. Kept
   exported here as well: the scene is where a caller looks for what a box says. */
export { displayName, displayYears } from '../model/labels.js';

/** A person's box. */
export interface PersonBox {
  readonly id: Xref;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The whole name, for the title and the accessible label. */
  readonly name: string;
  /**
   * What is drawn in the box.
   *
   * The same as `name` except for a name past the widest box the chart will draw, which is cut
   * here rather than in the component -- the scene is where what a box says is decided, and it is
   * the only place that can be asserted without mounting anything.
   */
  readonly label: string;
  /** Birth and death years, where the record gives them. */
  readonly years: string;
  readonly sex?: Sex;
}

/** A union's dot, and the fold control that hangs under it. */
export interface UnionDot {
  readonly id: Xref;
  readonly x: number;
  readonly y: number;
  /** True where the union has children, which is what makes it foldable. */
  readonly foldable: boolean;
  readonly collapsed: boolean;
  /** How many people this union is hiding, so the fold can say what it costs. */
  readonly hiding: number;
}

/** One drawn connector. */
export interface Connector {
  readonly id: string;
  readonly d: string;
  readonly kind: 'spouse' | 'descent';
}

/** The `(n)` beside a child's descent, saying which union they came from. */
export interface OrdinalMark {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export interface Scene {
  readonly persons: readonly PersonBox[];
  readonly unions: readonly UnionDot[];
  readonly connectors: readonly Connector[];
  readonly ordinals: readonly OrdinalMark[];
  readonly bounds: Bounds;
}

/** Everyone below a union, however deep, counted once. */
function descendantsOf(layout: Layout, family: Xref): number {
  const seen = new Set<Xref>();
  const pending = [...childrenOf(layout.relations, family)];
  while (pending.length > 0) {
    const person = pending.pop();
    if (person === undefined || seen.has(person)) continue;
    seen.add(person);
    for (const union of layout.relations.familiesOf.get(person) ?? []) {
      for (const spouse of spousesOf(layout.relations, union)) {
        if (spouse !== person) seen.add(spouse);
      }
      pending.push(...childrenOf(layout.relations, union));
    }
  }
  return seen.size;
}

function boundsOf(persons: readonly PersonBox[], unions: readonly UnionDot[]): Bounds {
  if (persons.length === 0 && unions.length === 0) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }
  const xs = [
    ...persons.flatMap((box) => [box.x, box.x + box.width]),
    ...unions.map((dot) => dot.x),
  ];
  const ys = [
    ...persons.flatMap((box) => [box.y, box.y + box.height]),
    ...unions.map((dot) => dot.y),
  ];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Turn a laid-out document into the list of things to draw. */
export function buildScene(
  doc: GedcomDoc,
  layout: Layout,
  collapsed: ReadonlySet<Xref> = new Set(),
): Scene {
  const byXref = new Map(doc.individuals.map((individual) => [individual.xref, individual]));

  const persons = [...layout.positions].map<PersonBox>(([id, at]) => {
    const individual = byXref.get(id);
    const name = individual === undefined ? id : displayName(individual);
    /* The width the pack made room for, so the box drawn is the box its neighbours were placed
       around. */
    const width = widthOf(layout.widths, id);
    return {
      id,
      x: at.x,
      y: at.y,
      width,
      height: GEOMETRY.nodeH,
      name,
      label: fitText(name, width - 2 * GEOMETRY.nodePadX, GEOMETRY.nameSize),
      years: individual === undefined ? '' : displayYears(individual),
      ...(individual?.sex === undefined ? {} : { sex: individual.sex }),
    };
  });

  const unions: UnionDot[] = [];
  const connectors: Connector[] = [];
  const ordinals: OrdinalMark[] = [];

  for (const [family, spot] of layout.unions) {
    const foldable = childrenOf(layout.relations, family).length > 0;
    unions.push({
      id: family,
      x: spot.x,
      y: spot.y,
      foldable,
      collapsed: collapsed.has(family),
      hiding: collapsed.has(family) ? descendantsOf(layout, family) : 0,
    });

    // Down from each box, sideways in this union's own lane, then down again to the dot. The
    // sideways run is what the lanes exist to separate: two of them sharing a height drew as one
    // unbroken stroke. The last drop is what keeps every dot on the row level anyway -- on the
    // topmost lane it has no length, and the path is the two-corner one it has always been.
    for (const spouse of spousesOf(layout.relations, family)) {
      const centre = layout.centres.get(spouse);
      const at = layout.positions.get(spouse);
      if (centre === undefined || at === undefined) continue;
      connectors.push({
        id: `${family}:${spouse}`,
        kind: 'spouse',
        d: ortho([
          [centre, at.y + GEOMETRY.nodeH],
          [centre, spot.runY],
          [spot.x, spot.runY],
          [spot.x, spot.y],
        ]),
      });
    }

    if (spot.barY === undefined || spot.stemX === undefined || spot.stemY === undefined)
      continue;

    // A drop, a short dogleg into the children's span, then the rise -- which is how the source
    // chart draws an offset child.
    connectors.push({
      id: `${family}:stem`,
      kind: 'descent',
      d: ortho([
        [spot.x, spot.y],
        [spot.x, spot.stemY],
        [spot.stemX, spot.stemY],
        [spot.stemX, spot.barY],
      ]),
    });

    /* One path per child, each turning down out of the bar. They overdraw each other along the
       shared run, which is what makes the sibling bar -- and it means every branch gets a rounded
       corner instead of only the two ends. */
    for (const child of spot.children ?? []) {
      const centre = layout.centres.get(child);
      const at = layout.positions.get(child);
      if (centre === undefined || at === undefined) continue;
      connectors.push({
        id: `${family}:${child}`,
        kind: 'descent',
        d: ortho([
          [spot.stemX, spot.barY],
          [centre, spot.barY],
          [centre, at.y],
        ]),
      });
      if (spot.ordinal !== undefined && spot.ordinal > 0) {
        // Beside the descent rather than on it, so the line does not strike it through.
        ordinals.push({
          id: `${family}:${child}:ordinal`,
          x: centre - 7,
          y: at.y - 7,
          text: `(${spot.ordinal})`,
        });
      }
    }
  }

  return { persons, unions, connectors, ordinals, bounds: boundsOf(persons, unions) };
}
