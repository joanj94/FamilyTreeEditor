/**
 * The measurements the drawing is built from.
 *
 * These are the companion pipeline's `VIEW_*` constants, carried over unchanged. They are not
 * taste: each was measured against the source chart, and several exist because a drawing without
 * them was reported as a *data* error -- a reader sent hunting in the right place for the wrong
 * reason, which is the most expensive kind of fault this project has.
 *
 * Keeping them in one table, rather than inline where each is used, is what lets the renderer and
 * the layout agree on a number without either owning it.
 */

/** The geometry a layout was computed with, carried in its result. */
export interface Geometry {
  readonly nodeW: number;
  readonly nodeH: number;
  readonly rowH: number;
  readonly gapX: number;
  readonly blockGap: number;
  readonly unionDrop: number;
  readonly laneH: number;
  readonly lanes: number;
  readonly laneSlop: number;
  readonly minUnionGap: number;
  readonly barLift: number;
  readonly stemDogleg: number;
  readonly minBarBelowDot: number;
  readonly ordinalStagger: number;
  readonly elbow: number;
}

export const GEOMETRY: Geometry = {
  /** A person's box. */
  nodeW: 150,
  nodeH: 58,
  /** One generation to the next. What is left over after `nodeH` is where the connectors run. */
  rowH: 200,
  /** Between two people inside one block -- a couple drawn side by side. */
  gapX: 22,
  /** Between neighbouring blocks on a row, which is what keeps two families apart. */
  blockGap: 64,
  /** How far under the boxes a union dot hangs. */
  unionDrop: 30,
  /**
   * How far apart two union connectors run. Two unions sharing a row and standing side by side
   * drew one unbroken stroke, which read as a single union joining eight people who were in four
   * separate couples; giving each horizontal its own height is what breaks the join.
   *
   * **A lane moves the sideways run, never the dot.** Every dot on a row hangs at one height, so
   * the fold boxes stand side by side instead of stacking -- which is why this is back at the
   * ported 14 after a spell at 30. The 30 was there to stop one union's fold box ending level
   * with the next union's dot, and dots that are all level cannot do that. Two unions at
   * different heights on the same row were reported as incoherent, and they were: the chart says
   * a generation is a row, so everything belonging to that generation has to sit on it.
   */
  laneH: 14,
  lanes: 4,
  /** How close two connectors may come before they count as touching. */
  laneSlop: 6,
  /**
   * The least horizontal distance between two union dots on the same row.
   *
   * A dot sits at the midpoint of its own spouses, so two unions whose couples happen to be
   * centred alike -- one wide, one narrow -- put their dots within a few pixels of each other and
   * are then told apart only by their lane. Measured on the test chart: two dots 10.5px apart,
   * which reads as one joint with two fold boxes stacked under it. A dot is nudged along its own
   * row to keep this much clear, and never past the spouse it belongs to.
   */
  minUnionGap: 46,
  /** How far the sibling bar is lifted off the row of the children it feeds. */
  barLift: 28,
  /** The short horizontal the stem jogs across before it drops to the bar. */
  stemDogleg: 18,
  /**
   * The floor that keeps the sibling bar off the fold box hanging under its own dot. Taken from
   * the child row alone, the two landed at exactly the same y on every remarriage on the source
   * chart -- a measured gap of 0px, and the knot the drawing was reported for.
   */
  minBarBelowDot: 34,
  /** How much a second or later union's bar is raised, so two bars do not coincide. */
  ordinalStagger: 18,
  /** The corner radius on an elbow. */
  elbow: 9,
};
