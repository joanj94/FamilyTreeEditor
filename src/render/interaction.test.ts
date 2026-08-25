/**
 * The interaction arithmetic.
 *
 * These are the rules a rendered chart cannot be inspected for. A capture set too early makes
 * every control in the scene dead without changing a single attribute; a fold control that draws
 * at one physical pixel is present, correct and unhittable; a zoom about the wrong point throws
 * what the reader was looking at off the screen. Each is a decision about a number, so each is
 * tested as one.
 */
import { describe, expect, it } from 'vitest';

import {
  CONTROL,
  DRAG_SLOP,
  beginDrag,
  controlScale,
  dragTo,
  endedInDrag,
  isDragClick,
  pinTo,
  toScreen,
  zoomAbout,
  type Viewport,
} from './interaction.js';

const view: Viewport = { scale: 1, tx: 0, ty: 0 };

describe('the drag slop', () => {
  it('does not capture the pointer when the gesture is still a click', () => {
    // Capturing here is what sent every click to the stage and killed every control in the scene.
    const gesture = beginDrag(1, 100, 100, view);
    const step = dragTo(gesture, 101, 102);
    expect(step.capture).toBe(false);
    expect(step.pan).toBeNull();
    expect(step.gesture.moved).toBe(false);
  });

  it('captures once, on the step where the gesture becomes a drag', () => {
    const gesture = beginDrag(1, 100, 100, view);
    const first = dragTo(gesture, 100 + DRAG_SLOP, 100);
    expect(first.capture).toBe(true);
    expect(first.gesture.moved).toBe(true);

    const second = dragTo(first.gesture, 140, 100);
    expect(second.capture).toBe(false);
    expect(second.pan).toEqual({ tx: 40, ty: 0 });
  });

  it('pans by the distance travelled, from wherever the chart already was', () => {
    const gesture = beginDrag(1, 100, 100, { tx: 25, ty: 60 });
    const moved = dragTo(gesture, 150, 130);
    expect(moved.pan).toEqual({ tx: 75, ty: 90 });
  });

  it('marks a finished drag, which is what releases the capture', () => {
    const gesture = beginDrag(1, 0, 0, view);
    expect(endedInDrag(gesture)).toBe(false);
    expect(endedInDrag(dragTo(gesture, 20, 0).gesture)).toBe(true);
    expect(endedInDrag(null)).toBe(false);
  });
});

describe('telling a click from the tail of a drag', () => {
  it('ignores the click that ends a pan', () => {
    // Releasing the mouse after panning should not also select whatever ended up under it.
    const panned = dragTo(beginDrag(1, 100, 100, view), 300, 100).gesture;
    expect(isDragClick(panned, 300, 100)).toBe(true);
  });

  it('lets a plain click through', () => {
    const still = beginDrag(1, 100, 100, view);
    expect(isDragClick(still, 101, 100)).toBe(false);
  });

  it('lets the click after a drag through', () => {
    // The regression this exists for. A flag set at the end of a drag can only be cleared by a
    // click that reaches something willing to clear it -- so a drag released over empty
    // background left it armed, and the *next* click, one the user meant, was swallowed. Found by
    // driving the real page: pan, then click a person, and nothing happened.
    const panned = dragTo(beginDrag(1, 100, 100, view), 300, 100).gesture;
    expect(isDragClick(panned, 300, 100)).toBe(true);

    // The next gesture is its own pointerdown, and is judged on its own travel.
    const fresh = beginDrag(2, 500, 400, view);
    expect(isDragClick(fresh, 500, 400)).toBe(false);
  });

  it('treats a click with no gesture behind it as a choice', () => {
    // A click from the keyboard, or one whose pointerdown landed outside the stage.
    expect(isDragClick(null, 10, 10)).toBe(false);
  });
});

describe('the fold controls', () => {
  it('leaves them alone at a readable zoom', () => {
    expect(controlScale(1)).toEqual({ k: 1, shown: true });
  });

  it('counter-scales them when they would draw too small to hit', () => {
    const { k, shown } = controlScale(0.5);
    expect(k).toBeGreaterThan(1);
    expect(CONTROL.size * 0.5 * k).toBeGreaterThanOrEqual(CONTROL.minPx);
    expect(shown).toBe(true);
  });

  it('stops growing them before they dwarf the families they belong to', () => {
    expect(controlScale(0.05).k).toBe(CONTROL.maxGrowth);
  });

  it('hides them once even a grown one is too small', () => {
    // Growth is capped, so past a certain zoom the counter-scale can no longer reach a hittable
    // size -- and a control that is drawn but cannot be hit is worse than one that is absent. Past
    // this point the whole-chart controls are what remains, and they work at any zoom.
    expect(controlScale(0.5).shown).toBe(true);
    expect(controlScale(0.25).shown).toBe(false);
  });
});

describe('zooming', () => {
  it('keeps what is under the cursor under the cursor', () => {
    const before: Viewport = { scale: 1, tx: 0, ty: 0 };
    const cursor = { x: 300, y: 200 };
    const after = zoomAbout(before, cursor.x, cursor.y, -1);

    // The scene point beneath the cursor, before and after, is the same point.
    const sceneX = (cursor.x - before.tx) / before.scale;
    expect(sceneX * after.scale + after.tx).toBeCloseTo(cursor.x, 6);
  });

  it('zooms in on a scroll up and out on a scroll down', () => {
    expect(zoomAbout(view, 0, 0, -1).scale).toBeGreaterThan(view.scale);
    expect(zoomAbout(view, 0, 0, 1).scale).toBeLessThan(view.scale);
  });

  it('will not zoom past the point of usefulness in either direction', () => {
    let out = view;
    for (let step = 0; step < 100; step += 1) out = zoomAbout(out, 0, 0, 1);
    expect(out.scale).toBeGreaterThan(0);

    let inwards = view;
    for (let step = 0; step < 100; step += 1) inwards = zoomAbout(inwards, 0, 0, -1);
    expect(inwards.scale).toBeLessThanOrEqual(3);
  });
});

describe('pinning a folded union', () => {
  it('leaves it on exactly the pixel it was already on', () => {
    // Folding re-packs the whole tree. Without this the chart leaps and the reader loses the place
    // they folded in order to look at.
    const before: Viewport = { scale: 0.75, tx: 40, ty: 90 };
    const wasAt = { x: 500, y: 300 };
    const screen = toScreen(before, wasAt);

    const movedTo = { x: 120, y: 300 };
    const after = pinTo(before, screen, movedTo);

    expect(toScreen(after, movedTo)).toEqual(screen);
    expect(after.scale).toBe(before.scale);
  });
});
