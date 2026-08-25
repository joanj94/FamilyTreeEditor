/**
 * Right-angled connectors with rounded corners.
 *
 * The radius is most of what makes a tree look drawn rather than plotted, and this is the whole of
 * how it is done: walk the points, and at each interior corner pull back along the incoming
 * segment, curve through the corner, and set off along the outgoing one.
 *
 * **Repeated points are dropped first, and that line is load-bearing.** A zero-length segment has
 * no direction, so dividing by its length yields `NaN`, and `NaN` in path data makes SVG discard
 * the path *silently* -- no console error, no exception, nothing in the DOM to inspect. The
 * failure shows up as a connector that is simply absent, which reads as a missing relationship.
 * That is a drawing that lies, and it cost the companion project real time to find.
 */
import { GEOMETRY } from '../layout/layout.js';

/** A point on a connector, as `[x, y]`. */
export type PathPoint = readonly [number, number];

/** The SVG `d` for a run of right angles. Empty where there is nothing to draw. */
export function ortho(points: readonly PathPoint[]): string {
  const path: PathPoint[] = [];
  for (const point of points) {
    const last = path[path.length - 1];
    if (last === undefined || last[0] !== point[0] || last[1] !== point[1]) path.push(point);
  }

  const start = path[0];
  const end = path[path.length - 1];
  if (path.length < 2 || start === undefined || end === undefined) return '';

  let d = `M${start[0]},${start[1]}`;
  for (let index = 1; index < path.length - 1; index += 1) {
    const before = path[index - 1];
    const corner = path[index];
    const after = path[index + 1];
    if (before === undefined || corner === undefined || after === undefined) continue;

    const [ax, ay] = before;
    const [bx, by] = corner;
    const [zx, zy] = after;
    const back = Math.hypot(bx - ax, by - ay);
    const on = Math.hypot(zx - bx, zy - by);
    const radius = Math.min(GEOMETRY.elbow, back / 2, on / 2);

    d +=
      ` L${bx - ((bx - ax) / back) * radius},${by - ((by - ay) / back) * radius}` +
      ` Q${bx},${by}` +
      ` ${bx + ((zx - bx) / on) * radius},${by + ((zy - by) / on) * radius}`;
  }
  return `${d} L${end[0]},${end[1]}`;
}
