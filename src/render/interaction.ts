/**
 * The pieces of interaction that are arithmetic rather than DOM.
 *
 * They are here, apart from the component, because each encodes a fault that was expensive to find
 * and none of them can be checked by looking at a rendered tree.
 *
 * **A fold box is a fixed-size control in a scene that zooms.** At the scale a large chart is
 * first fitted to, a 16px box draws at about one physical pixel and cannot be hit at all, so it is
 * counter-scaled about its own anchor -- but only up to a point, because counter-scaling all the
 * way down turns the folds into blobs larger than the families they belong to, which is a
 * different kind of unreadable. Past that they are hidden, and the whole-chart controls are what
 * remains. The union dot is deliberately not counter-scaled: it is a drawn junction as much as a
 * control, and growing it as the chart shrinks made it read as a blot on the connector rather than
 * a point on it.
 *
 * **Pointer capture waits for the drag to become a drag.** While a capture is set, the Pointer
 * Events spec dispatches `click` to the capture target override rather than to the element under
 * the cursor -- so capturing on `pointerdown` sends every click to the stage, and every control
 * inside the scene stops working. Silently: no error, nothing in the DOM to inspect, just a chart
 * that cannot be clicked. Waiting for movement fixes both ends of it. A plain click never sets
 * capture and reaches the target; a drag sets it, and the click that ends a drag is then
 * suppressed, which is what one wants anyway -- releasing the mouse after panning should not also
 * select whatever happened to end up under it.
 */

export const CONTROL = {
  /** The drawn size of a fold box, in layout units. */
  size: 16,
  /** Below this many physical pixels a control cannot be hit reliably. */
  minPx: 14,
  /** Counter-scaling stops here; past it the controls would dwarf the families. */
  maxGrowth: 2,
  /** Below this many physical pixels, even a counter-scaled control is hidden. */
  hideBelowPx: 9,
} as const;

export interface ControlScale {
  /** The factor to counter-scale a control by, about its own anchor. */
  readonly k: number;
  /** False where the control is too small to be worth drawing at all. */
  readonly shown: boolean;
}

/** How much to counter-scale the fold controls at this zoom, and whether to draw them. */
export function controlScale(scale: number): ControlScale {
  const natural = CONTROL.size * scale;
  const k = Math.min(CONTROL.maxGrowth, Math.max(1, CONTROL.minPx / natural));
  return { k, shown: natural * k >= CONTROL.hideBelowPx };
}

/** How far a pointer must travel, in pixels, before the gesture counts as a drag. */
export const DRAG_SLOP = 4;

/** A pointer gesture in progress. */
export interface Gesture {
  readonly pointerId: number;
  /** Where the pointer went down, in client coordinates. */
  readonly fromX: number;
  readonly fromY: number;
  /** The pan offset when it went down. */
  readonly panX: number;
  readonly panY: number;
  /** True once the gesture has travelled far enough to be a drag. */
  readonly moved: boolean;
}

/** Start tracking a gesture. Nothing is captured yet, and that is the point. */
export function beginDrag(
  pointerId: number,
  clientX: number,
  clientY: number,
  pan: { readonly tx: number; readonly ty: number },
): Gesture {
  return {
    pointerId,
    fromX: clientX,
    fromY: clientY,
    panX: clientX - pan.tx,
    panY: clientY - pan.ty,
    moved: false,
  };
}

export interface DragStep {
  readonly gesture: Gesture;
  /** True on the step where the gesture became a drag: capture the pointer now, and only now. */
  readonly capture: boolean;
  /** Where the scene should be panned to, or null while the gesture is still a click. */
  readonly pan: { readonly tx: number; readonly ty: number } | null;
}

/** Advance a gesture. Returns what the caller should do about it. */
export function dragTo(gesture: Gesture, clientX: number, clientY: number): DragStep {
  if (!gesture.moved) {
    const travel = Math.abs(clientX - gesture.fromX) + Math.abs(clientY - gesture.fromY);
    if (travel < DRAG_SLOP) return { gesture, capture: false, pan: null };
    const moved = { ...gesture, moved: true };
    return {
      gesture: moved,
      capture: true,
      pan: { tx: clientX - moved.panX, ty: clientY - moved.panY },
    };
  }
  return {
    gesture,
    capture: false,
    pan: { tx: clientX - gesture.panX, ty: clientY - gesture.panY },
  };
}

/** Whether this gesture ended as a drag, and so held a pointer capture to release. */
export function endedInDrag(gesture: Gesture | null): boolean {
  return gesture !== null && gesture.moved;
}

/**
 * Whether a click is the tail of a drag rather than a choice.
 *
 * Judged against the click's *own* `pointerdown`, not against a flag left over from the last
 * gesture. A flag is the obvious implementation and it is wrong: it can only be cleared by a click
 * that reaches something willing to clear it, so a drag released over empty background leaves it
 * armed and the next real click -- a click the user meant -- is swallowed instead. That failure is
 * invisible in the code and maddening in the hand, since every other click works.
 *
 * Comparing coordinates has no such state. Every click is preceded by its own `pointerdown`, so
 * each one is judged on its own travel and nothing carries over.
 */
export function isDragClick(
  gesture: Gesture | null,
  clientX: number,
  clientY: number,
): boolean {
  if (gesture === null) return false;
  return Math.abs(clientX - gesture.fromX) + Math.abs(clientY - gesture.fromY) >= DRAG_SLOP;
}

/** The zoom limits. Beyond them the chart is either a smear or a single box. */
export const ZOOM = { min: 0.08, max: 3, step: 1.12 } as const;

export interface Viewport {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}

/**
 * Zoom about a point, so that what is under the cursor stays under the cursor.
 *
 * Zooming about the origin instead is the difference between magnifying what someone is looking at
 * and throwing it off the screen.
 */
export function zoomAbout(view: Viewport, px: number, py: number, deltaY: number): Viewport {
  const next = Math.min(
    ZOOM.max,
    Math.max(ZOOM.min, view.scale * (deltaY < 0 ? ZOOM.step : 1 / ZOOM.step)),
  );
  return {
    scale: next,
    tx: px - (px - view.tx) * (next / view.scale),
    ty: py - (py - view.ty) * (next / view.scale),
  };
}

/**
 * Where a union sits on screen, and where the pan must go to keep it there.
 *
 * Folding re-packs the whole tree, so without this the chart leaps across the screen and the
 * reader has to find their place again -- which defeats the point of folding, since one folds in
 * order to look at what is left. The union that was clicked is pinned to the pixel it was already
 * on, and everything else closes up around it.
 */
export function pinTo(
  view: Viewport,
  screen: { readonly sx: number; readonly sy: number },
  after: { readonly x: number; readonly y: number },
): Viewport {
  return {
    ...view,
    tx: screen.sx - after.x * view.scale,
    ty: screen.sy - after.y * view.scale,
  };
}

/** Where a point in the scene currently sits on screen. */
export function toScreen(view: Viewport, at: { readonly x: number; readonly y: number }) {
  return { sx: at.x * view.scale + view.tx, sy: at.y * view.scale + view.ty };
}

/**
 * Move the chart so a point in the scene sits in the middle of the stage.
 *
 * What the search box needs. Selecting somebody the reader cannot see is not finding them: on a
 * chart wide enough to want a search box at all, the person found is almost never on screen, and
 * a selection that only opened the record panel would leave the chart showing the same strangers
 * it was showing before.
 *
 * The scale is left alone. Zooming to the person as well is the obvious extra and it is wrong:
 * the reader chose that zoom, it is how much family they want in view at once, and taking it away
 * from them to answer a search is a bigger change than they asked for.
 */
export function centreOn(
  view: Viewport,
  at: { readonly x: number; readonly y: number },
  stage: { readonly width: number; readonly height: number },
): Viewport {
  return {
    ...view,
    tx: stage.width / 2 - at.x * view.scale,
    ty: stage.height / 2 - at.y * view.scale,
  };
}
