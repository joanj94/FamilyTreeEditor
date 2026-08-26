/**
 * How many connectors cross one another.
 *
 * The chart was reported as messy, and the word for what is wrong is *crossings*: lines passing
 * over lines, so that a reader tracing a descent arrives at the wrong family. Overlap was the
 * first guess and it was wrong -- no connector passes through a box -- so this counts the fault
 * that is actually there, and counts it as a number rather than as an impression.
 *
 * **A touch is not a crossing.** Every connector on the chart is elbows meeting end to end, and
 * every child meets its own sibling bar in a T. Counting those would count the drawing itself, so
 * only a *proper* crossing counts: both segments pierced strictly between their own ends. That is
 * also why children of one union overdrawing the shared run of their bar count nothing.
 *
 * **The routing here is the renderer's, restated.** `render/scene.ts` turns the same placements
 * into the same polylines; the layering rule keeps this module from importing it, so the shape is
 * written twice and `scene.test.ts` holds the two to each other. Measuring anything but what is
 * drawn would be measuring nothing.
 */
import { GEOMETRY } from './geometry.js';
import { spousesOf, type Relations } from './relations.js';
import type { UnionPlacement } from './pack.js';
import type { Xref } from '../model/types.js';

/** A point on a connector, as `[x, y]`. */
export type PathPoint = readonly [number, number];

/** One straight run of a connector, carrying the connector it came from. */
export interface Segment {
  /** The connector's identifier, which is what a counted pair is reported as. */
  readonly id: string;
  readonly from: PathPoint;
  readonly to: PathPoint;
}

/**
 * What the metric reads.
 *
 * A `Layout` is one. So is a trial packing that has not been made into a layout yet, which is what
 * lets an ordering pass score a candidate order without building the whole result.
 */
export interface Chart {
  readonly relations: Relations;
  readonly positions: ReadonlyMap<Xref, { readonly y: number }>;
  readonly centres: ReadonlyMap<Xref, number>;
  readonly unions: ReadonlyMap<Xref, UnionPlacement>;
}

/**
 * How far off the line a point may be and still count as on it.
 *
 * The comparison below is a cross product, so this is in square pixels. Every coordinate on the
 * chart is arrived at by halving and adding whole pixels, which lands exactly on binary
 * fractions; the slack is here so that a future coordinate arrived at by division cannot turn a
 * touch into a crossing.
 */
const EPSILON = 1e-6;

/** A segment, for tests and for anyone assembling one by hand. */
export function segment(id: string, from: PathPoint, to: PathPoint): Segment {
  return { id, from, to };
}

/** Which side of `a`-`b` the point `c` falls on: positive, negative, or on the line. */
function side(a: PathPoint, b: PathPoint, c: PathPoint): number {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return cross > EPSILON ? 1 : cross < -EPSILON ? -1 : 0;
}

/**
 * Whether two segments properly cross: each pierced strictly between its own ends.
 *
 * Both ends of one falling on opposite sides of the other, and the same the other way round. A
 * shared endpoint, a T-junction and a collinear overlap each put a zero into one of the four
 * tests, so all three count as nothing -- which is why the test is written this way rather than
 * as an intersection point.
 */
export function crosses(first: Segment, second: Segment): boolean {
  const a = side(first.from, first.to, second.from);
  const b = side(first.from, first.to, second.to);
  const c = side(second.from, second.to, first.from);
  const d = side(second.from, second.to, first.to);
  return a * b < 0 && c * d < 0;
}

interface Extent {
  readonly at: Segment;
  readonly loX: number;
  readonly hiX: number;
  readonly loY: number;
  readonly hiY: number;
}

function extentOf(at: Segment): Extent {
  return {
    at,
    loX: Math.min(at.from[0], at.to[0]),
    hiX: Math.max(at.from[0], at.to[0]),
    loY: Math.min(at.from[1], at.to[1]),
    hiY: Math.max(at.from[1], at.to[1]),
  };
}

function byId(left: readonly [string, string], right: readonly [string, string]): number {
  if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
  if (left[1] !== right[1]) return left[1] < right[1] ? -1 : 1;
  return 0;
}

/**
 * Every crossing pair, each named by the two connectors involved and reported once.
 *
 * Comparing every pair is quadratic, and a chart of ten thousand people has connectors in the tens
 * of thousands. Two cheap filters make that tractable without changing a single answer: a pair can
 * only cross if their x ranges overlap, and only if their y ranges do. Both are necessary for the
 * test above, so skipping on either cannot lose a crossing.
 */
export function crossingPairs(
  segments: readonly Segment[],
): readonly (readonly [string, string])[] {
  const extents = segments
    .map(extentOf)
    .filter((extent) => extent.loX !== extent.hiX || extent.loY !== extent.hiY)
    .sort((left, right) => left.loX - right.loX || left.loY - right.loY);

  const found: [string, string][] = [];
  extents.forEach((left, index) => {
    for (let other = index + 1; other < extents.length; other += 1) {
      const right = extents[other];
      if (right === undefined) continue;
      if (right.loX > left.hiX) break;
      if (left.loY > right.hiY || right.loY > left.hiY) continue;
      if (!crosses(left.at, right.at)) continue;
      found.push(
        left.at.id <= right.at.id ? [left.at.id, right.at.id] : [right.at.id, left.at.id],
      );
    }
  });

  return found.sort(byId);
}

/** How many pairs of the given segments cross. */
export function countSegmentCrossings(segments: readonly Segment[]): number {
  return crossingPairs(segments).length;
}

/** The straight runs of one connector, with repeated points dropped as `ortho` drops them. */
function runsOf(id: string, points: readonly PathPoint[]): Segment[] {
  const path: PathPoint[] = [];
  for (const point of points) {
    const last = path[path.length - 1];
    if (last === undefined || last[0] !== point[0] || last[1] !== point[1]) path.push(point);
  }
  const runs: Segment[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    if (from !== undefined && to !== undefined) runs.push({ id, from, to });
  }
  return runs;
}

/**
 * Every connector on the chart, as straight runs.
 *
 * The three the renderer draws: down from each spouse, sideways in the union's own lane and down
 * to the dot; the stem doglegging from the dot into the children's span; and one path per child
 * turning down out of the bar.
 */
export function connectorSegments(chart: Chart): readonly Segment[] {
  const segments: Segment[] = [];

  for (const [family, spot] of chart.unions) {
    for (const spouse of spousesOf(chart.relations, family)) {
      const centre = chart.centres.get(spouse);
      const at = chart.positions.get(spouse);
      if (centre === undefined || at === undefined) continue;
      segments.push(
        ...runsOf(`${family}:${spouse}`, [
          [centre, at.y + GEOMETRY.nodeH],
          [centre, spot.runY],
          [spot.x, spot.runY],
          [spot.x, spot.y],
        ]),
      );
    }

    if (spot.barY === undefined || spot.stemX === undefined || spot.stemY === undefined) {
      continue;
    }

    segments.push(
      ...runsOf(`${family}:stem`, [
        [spot.x, spot.y],
        [spot.x, spot.stemY],
        [spot.stemX, spot.stemY],
        [spot.stemX, spot.barY],
      ]),
    );

    for (const child of spot.children ?? []) {
      const centre = chart.centres.get(child);
      const at = chart.positions.get(child);
      if (centre === undefined || at === undefined) continue;
      segments.push(
        ...runsOf(`${family}:${child}`, [
          [spot.stemX, spot.barY],
          [centre, spot.barY],
          [centre, at.y],
        ]),
      );
    }
  }

  return segments;
}

/** How many pairs of connectors cross on this chart. The number an ordering pass drives down. */
export function countCrossings(chart: Chart): number {
  return countSegmentCrossings(connectorSegments(chart));
}
