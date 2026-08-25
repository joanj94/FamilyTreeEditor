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
import { childrenOf, spousesOf } from '../layout/relations.js';
import { ortho } from './ortho.js';
import type { GedcomDoc, Individual, Sex, Xref } from '../model/types.js';

/** A person's box. */
export interface PersonBox {
  readonly id: Xref;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly name: string;
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

/**
 * What a box says.
 *
 * The `NAME` payload is authoritative and already carries the whole name, with the surname
 * delimited by slashes; the pieces beside it are this tool's reading of it. So the payload is what
 * is drawn, with the delimiters taken out. A person with no name at all is drawn under their
 * identifier rather than as an empty box, because an empty box cannot be clicked with confidence.
 */
export function displayName(individual: Individual): string {
  const written = individual.names?.[0];
  const value = written?.value?.replace(/\//g, '').replace(/\s+/g, ' ').trim();
  if (value !== undefined && value !== '') return value;

  const pieces = [...(written?.given ?? []), ...(written?.surname ?? [])].join(' ').trim();
  return pieces === '' ? individual.xref : pieces;
}

/** The years under the name: birth and death, where the record gives them. */
export function displayYears(individual: Individual): string {
  const year = (tag: 'BIRT' | 'DEAT'): string => {
    const event = individual.events?.find((candidate) => candidate.tag === tag);
    const parsed = event?.date?.start?.year;
    if (parsed !== undefined) return String(parsed);
    /* An unparsed date still has its payload, and a reader would rather see it than nothing. */
    return event?.date?.value ?? '';
  };
  const born = year('BIRT');
  const died = year('DEAT');
  if (born === '' && died === '') return '';
  return `${born}–${died}`;
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
    return {
      id,
      x: at.x,
      y: at.y,
      width: GEOMETRY.nodeW,
      height: GEOMETRY.nodeH,
      name: individual === undefined ? id : displayName(individual),
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

    // Down from each box, then sideways to the dot. The sideways run is what the lanes exist to
    // separate: two of them sharing a y drew as one unbroken stroke.
    for (const spouse of spousesOf(layout.relations, family)) {
      const centre = layout.centres.get(spouse);
      const at = layout.positions.get(spouse);
      if (centre === undefined || at === undefined) continue;
      connectors.push({
        id: `${family}:${spouse}`,
        kind: 'spouse',
        d: ortho([
          [centre, at.y + GEOMETRY.nodeH],
          [centre, spot.y],
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
