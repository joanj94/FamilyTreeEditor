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
import { ordinal } from '../layout/pack.js';
import type { Translate } from '../i18n/keys.js';
import {
  displayCaption,
  displayMarks,
  displayName,
  displayUnionCaption,
  displayUnionMarks,
  displayXref,
} from '../model/labels.js';
import type { GedcomDoc, Sex, Xref } from '../model/types.js';

/* The chart's reading of a record is shared with the layout, which sizes the boxes from it. Kept
   exported here as well: the scene is where a caller looks for what a box says. */
export {
  displayCaption,
  displayMarks,
  displayName,
  displayUnionCaption,
  displayUnionMarks,
  displayXref,
  displayYears,
} from '../model/labels.js';

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
  /**
   * The line under the name: the sign for the sex, then the years, a death carrying its dagger.
   *
   * One string because it is one line, and because this is what the box was measured against --
   * see `personWidth`.
   */
  readonly marks: string;
  /**
   * The same facts in words, for the accessible label.
   *
   * A screen reader given `marks` says "female sign" and "dagger", which describes the drawing
   * rather than the person. Signs are for the eye; this is for the ear.
   */
  readonly caption: string;
  readonly sex?: Sex;
}

/** A union's dot, and the fold control that hangs under it. */
export interface UnionDot {
  readonly id: Xref;
  readonly x: number;
  readonly y: number;
  /**
   * Which of a partner's marriages this is, or 0 where neither of them married more than once.
   *
   * The same number the descents below it carry. It is drawn at the dot as well because a folded
   * union has no descents to carry it, and because a reader asking which marriage a couple is
   * should be able to ask the couple rather than their children.
   */
  readonly ordinal: number;
  /**
   * The height that number is written at: just above the dot it names.
   *
   * It sat above the whole lane stack instead, to keep it off the sideways runs. That holds for
   * two unions and falls apart past them -- every extra marriage on the row opens another lane
   * and drops the dots by one more lane's height, while the mark stayed where it was. At four
   * marriages it floated 48 units up with three connectors between it and the dot, naming
   * nothing. Sitting on the dot is what makes it coherent however many lanes the row uses, and
   * a run passing behind it is knocked out by the halo in `chart.css` rather than avoided.
   *
   * Every dot on a row shares a height, so every mark on a row still lines up with every other.
   */
  readonly ordinalY: number;
  /**
   * What the union itself says: the marriage and the divorce, signed and dated.
   *
   * The dot's counterpart to a box's `marks`, and read the same way -- see `displayUnionMarks`.
   * Empty where the record gives neither, which is most unions in most files.
   */
  readonly marks: string;
  /**
   * The same facts in words, for the accessible label.
   *
   * A screen reader makes "equals" and "not-equals" of the signs, which is the
   * typography rather than the couple. Signs are for the eye; this is for
   * the ear.
   */
  readonly caption: string;
  /**
   * Where that line starts: below the dot and out to its right.
   *
   * Not above, which is the ordinal's -- and that one has to stay centred on the dot to name it.
   * Not on the dot's own baseline, which is where the sideways spouse run passes. Not directly
   * below either, which is the fold's. What is left is the corner between them, and it is
   * genuinely empty: see `MARKS_OFFSET` and `MARKS_DROP`.
   *
   * Anchored at the start rather than centred: a mark that grew in both directions would reach
   * for the left-hand partner's drop as readily as the right-hand one's.
   */
  readonly marksX: number;
  readonly marksY: number;
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
  /** The union it runs from. */
  readonly family: Xref;
  /**
   * The person at the other end, where it has one.
   *
   * Carried rather than left to be read back out of the identifier. The chart draws a line in
   * bold when both of its ends are in the selected person's lineage, and a renderer that had to
   * split `@F1@:@I3@` on a colon to learn that would be one `@`-less identifier away from being
   * wrong -- the standard permits any `@[A-Z0-9_]+@`, and nothing stops a colon-free convention
   * elsewhere from becoming a colon-bearing one here. A union's own stem has no person.
   */
  readonly person?: Xref;
}

/** The `(n)` beside a child's descent, saying which union they came from. */
export interface OrdinalMark {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/**
 * The generation a row is, written in the margin at either end of it.
 *
 * The chart is a grid of rows and nothing on it says how deep a row is: a reader counting
 * generations has to trace a line of descent up to the founders and count the boxes, and on a
 * chart wide enough to need panning they lose their place doing it. The number says it outright.
 *
 * **Counted from 1 at the top, and re-counted whenever the tree changes shape.** It is the row
 * plus one, and the top row is row 0 by construction -- see `depths`. Give somebody on the fifth
 * generation a father and he is drawn on the fourth, because the rows were settled from the whole
 * tree rather than numbered off the drawing.
 *
 * Written at both ends of the row because the chart pans: a reader looking at the right-hand edge
 * of a wide family should not have to travel back across it to learn which generation they are on.
 */
export interface GenerationLabel {
  readonly id: string;
  /** What is written: the row plus one, so the founders' row reads as 1. */
  readonly generation: number;
  /** The baseline, level with the middle of the boxes on the row. */
  readonly y: number;
  /** Where it is written left of the chart. Anchored at its end, so it grows away from the boxes. */
  readonly x: number;
  /** And right of it, anchored at its start for the same reason. */
  readonly rightX: number;
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
  /** One per row that has anybody on it, top first. */
  readonly generations: readonly GenerationLabel[];
  readonly bounds: Bounds;
}

/** How far above its dot a union's marriage number is written, clearing the dot's own radius. */
const MARK_LIFT = 11;

/**
 * How far right of its dot a union's marks start.
 *
 * Past the fold's box as well as the dot: the box is 16 wide on the dot's own centre, so anything
 * starting inside `x + 8` would be written over the control.
 */
const MARKS_OFFSET = 12;

/**
 * How far below the dot the marks' baseline sits.
 *
 * On the dot's own line first, which put them on the sideways run -- a union on the bottom lane
 * has `runY` equal to its dot's `y`, so the spouse run passes exactly through that baseline, and
 * the halo that was meant to protect the text from the line instead cut the line in two. A
 * connector with a bite out of it reads as a relationship that does not connect.
 *
 * Below is the free quadrant. Above it are the lane runs, stacked one per marriage on the row;
 * below there is only the fold's box, which `MARKS_OFFSET` clears sideways, and the descent stem,
 * which drops on the dot's own centre.
 */
const MARKS_DROP = 14;

/**
 * How far out from the chart's own edge a generation number is written.
 *
 * Clear of the widest box on any row, not of the row it labels: the numbers are a column, and a
 * column that stepped in and out with the shape of each row would read as part of the drawing
 * rather than as a scale beside it.
 */
export const GUTTER = 44;

/**
 * The number's baseline, measured down from the top of the boxes on its row.
 *
 * Level with the middle of a box rather than with the name inside it. It names the whole row, and
 * a row is as tall as its boxes.
 */
const GENERATION_BASELINE = GEOMETRY.nodeH / 2 + 8;

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

/**
 * A number for every row that has somebody drawn on it.
 *
 * Read from the boxes rather than from the whole document, so a folded branch takes its rows'
 * numbers away with it: a number standing beside an empty band of chart would be naming nothing.
 * The rows above a fold are untouched, since folding hides descendants and never ancestors.
 */
function generationsOf(
  persons: readonly PersonBox[],
  layout: Layout,
): readonly GenerationLabel[] {
  if (persons.length === 0) return [];
  const left = Math.min(...persons.map((box) => box.x));
  const right = Math.max(...persons.map((box) => box.x + box.width));
  const rows = new Set(persons.map((box) => layout.depth.get(box.id) ?? 0));
  return [...rows]
    .sort((first, second) => first - second)
    .map((row) => ({
      id: `generation:${String(row)}`,
      generation: row + 1,
      y: row * GEOMETRY.rowH + GENERATION_BASELINE,
      x: left - GUTTER,
      rightX: right + GUTTER,
    }));
}

/**
 * What the drawing occupies.
 *
 * The generation numbers are in it: they are drawn, so a viewport fitted to the bounds has to
 * hold them. Their own width is not -- like the marks beside a union dot, nothing measures the
 * text -- but the gutter either side is wider than a number ever is.
 */
function boundsOf(
  persons: readonly PersonBox[],
  unions: readonly UnionDot[],
  generations: readonly GenerationLabel[] = [],
): Bounds {
  if (persons.length === 0 && unions.length === 0) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }
  const xs = [
    ...persons.flatMap((box) => [box.x, box.x + box.width]),
    ...unions.map((dot) => dot.x),
    ...generations.flatMap((mark) => [mark.x, mark.rightX]),
  ];
  const ys = [
    ...persons.flatMap((box) => [box.y, box.y + box.height]),
    ...unions.map((dot) => dot.y),
    ...generations.map((mark) => mark.y),
  ];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * Turn a laid-out document into the list of things to draw.
 *
 * `t` is here for the captions -- the spoken form of a box and of a dot, and therefore the only
 * part of a scene that has a language. Everything else -- names, years, signs, coordinates -- reads
 * the same in every locale, which is why the translator is passed rather than the whole scene
 * being rebuilt per language.
 *
 * It goes third because `collapsed` has a default, and a required parameter cannot follow an
 * optional one.
 */
export function buildScene(
  doc: GedcomDoc,
  layout: Layout,
  t: Translate,
  collapsed: ReadonlySet<Xref> = new Set(),
): Scene {
  const byXref = new Map(doc.individuals.map((individual) => [individual.xref, individual]));
  /* The unions are walked from the layout, which knows where a dot goes and nothing about what it
     says. The record is what carries the marriage and the divorce. */
  const familyOf = new Map(doc.families.map((family) => [family.xref, family]));

  const persons = [...layout.positions].map<PersonBox>(([id, at]) => {
    const individual = byXref.get(id);
    const name = individual === undefined ? displayXref(id) : displayName(individual);
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
      marks: individual === undefined ? '' : displayMarks(individual),
      caption: individual === undefined ? name : displayCaption(individual, t),
      ...(individual?.sex === undefined ? {} : { sex: individual.sex }),
    };
  });

  const unions: UnionDot[] = [];
  const connectors: Connector[] = [];
  const ordinals: OrdinalMark[] = [];

  for (const [family, spot] of layout.unions) {
    const foldable = childrenOf(layout.relations, family).length > 0;
    const record = familyOf.get(family);
    unions.push({
      id: family,
      x: spot.x,
      y: spot.y,
      marks: record === undefined ? '' : displayUnionMarks(record),
      caption: record === undefined ? '' : displayUnionCaption(record, t),
      marksX: spot.x + MARKS_OFFSET,
      marksY: spot.y + MARKS_DROP,
      /* Read from the relations rather than from the laid-out spot: the spot only carries an
         ordinal where it has children to draw, and a childless or folded remarriage is still the
         second marriage. */
      ordinal: ordinal(family, layout.relations),
      ordinalY: spot.y - MARK_LIFT,
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
        family,
        person: spouse,
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
      family,
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
        family,
        person: child,
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

  const generations = generationsOf(persons, layout);
  return {
    persons,
    unions,
    connectors,
    ordinals,
    generations,
    bounds: boundsOf(persons, unions, generations),
  };
}
