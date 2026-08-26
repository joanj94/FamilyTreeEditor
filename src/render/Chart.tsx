/**
 * The chart, drawn.
 *
 * React owns the tree structure -- which boxes, dots and connectors exist -- and nothing else.
 * **The pan/zoom transform is deliberately outside React state.** A drag produces a pointer event
 * every frame, and routing those through `setState` re-renders a scene of several hundred nodes
 * for a transform that one `setAttribute` could have done. The viewport lives in a ref and is
 * written straight onto the scene group; React never learns that the chart moved, because it does
 * not need to.
 *
 * Folding *is* state, because it changes what exists. It re-packs the tree, so the union that was
 * clicked is pinned to the pixel it was already on -- see `pinTo`. Without that the chart leaps
 * across the screen and the reader has to find their place again, which defeats the point of
 * folding.
 *
 * The two hard-won details from the companion viewer live in `interaction.ts`, with the reasoning:
 * pointer capture waits for the drag to become a drag, and the fold controls are counter-scaled so
 * they stay hittable when the chart is zoomed out.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { computeLayout } from '../layout/layout.js';
import { buildScene, displayXref } from './scene.js';
import {
  beginDrag,
  controlScale,
  dragTo,
  endedInDrag,
  isDragClick,
  pinTo,
  toScreen,
  zoomAbout,
  type Gesture,
  type Viewport,
} from './interaction.js';
import type { GedcomDoc, Xref } from '../model/types.js';

import './chart.css';

export interface ChartProps {
  readonly doc: GedcomDoc;
  /** Raised when a person is chosen. The chart selects nothing itself; that is the editor's. */
  readonly onSelectPerson?: (xref: Xref) => void;
  readonly onSelectUnion?: (xref: Xref) => void;
}

/** Where the chart opens. Close enough to read, far enough to see a family at once. */
const OPENS_AT: Viewport = { scale: 0.75, tx: 40, ty: 90 };

export function Chart({ doc, onSelectPerson, onSelectUnion }: ChartProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<Xref>>(() => new Set<Xref>());

  const layout = useMemo(() => computeLayout(doc, { collapsed }), [doc, collapsed]);
  const scene = useMemo(() => buildScene(doc, layout, collapsed), [doc, layout, collapsed]);

  const stageRef = useRef<SVGSVGElement | null>(null);
  const sceneRef = useRef<SVGGElement | null>(null);
  const view = useRef<Viewport>(OPENS_AT);
  const gesture = useRef<Gesture | null>(null);
  /* Kept past the end of the gesture, because the click that follows is judged against it. */
  const lastDown = useRef<Gesture | null>(null);
  const pinned = useRef<{ family: Xref; sx: number; sy: number } | null>(null);

  /** Write the viewport onto the scene, and re-size the controls that fight the zoom. */
  const apply = useCallback(() => {
    const group = sceneRef.current;
    if (group === null) return;
    const { scale, tx, ty } = view.current;
    group.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);

    const { k, shown } = controlScale(scale);
    for (const control of group.querySelectorAll<SVGGElement>('[data-control]')) {
      const cx = Number(control.dataset['cx'] ?? 0);
      const cy = Number(control.dataset['cy'] ?? 0);
      control.style.display = shown ? '' : 'none';
      control.setAttribute(
        'transform',
        `translate(${cx},${cy}) scale(${k}) translate(${-cx},${-cy})`,
      );
    }
  }, []);

  /* Re-applied after every render because the controls are re-created with the scene, and a new
     element carries no transform. */
  useLayoutEffect(() => {
    apply();
  }, [apply, scene]);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;

    const onPointerDown = (event: PointerEvent): void => {
      const started = beginDrag(event.pointerId, event.clientX, event.clientY, view.current);
      gesture.current = started;
      lastDown.current = started;
    };

    const onPointerMove = (event: PointerEvent): void => {
      const current = gesture.current;
      if (current === null) return;
      const step = dragTo(current, event.clientX, event.clientY);
      gesture.current = step.gesture;
      if (step.capture) {
        stage.classList.add('dragging');
        stage.setPointerCapture(step.gesture.pointerId);
      }
      if (step.pan !== null) {
        view.current = { ...view.current, ...step.pan };
        apply();
      }
    };

    const onPointerUp = (): void => {
      const current = gesture.current;
      if (current !== null && endedInDrag(current)) {
        lastDown.current = current;
        if (stage.hasPointerCapture(current.pointerId)) {
          stage.releasePointerCapture(current.pointerId);
        }
      }
      gesture.current = null;
      stage.classList.remove('dragging');
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      view.current = zoomAbout(
        view.current,
        event.clientX - box.left,
        event.clientY - box.top,
        event.deltaY,
      );
      apply();
    };

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
      stage.removeEventListener('wheel', onWheel);
    };
  }, [apply]);

  /* Put the folded union back where it was. This runs after the re-pack, which is the only moment
     at which both the old screen position and the new layout position are known. */
  useLayoutEffect(() => {
    const held = pinned.current;
    if (held === null) return;
    pinned.current = null;
    const after = layout.unions.get(held.family);
    if (after === undefined) return;
    view.current = pinTo(view.current, held, after);
    apply();
  }, [layout, apply]);

  /**
   * Whether a click is a choice or the tail of a pan.
   *
   * Judged against the click's own `pointerdown`. Releasing the mouse after panning should not
   * select whatever ended up under it -- and, just as importantly, the click *after* that should
   * work normally, which is what a leftover flag gets wrong.
   */
  const chose = (event: { clientX: number; clientY: number }): boolean =>
    !isDragClick(lastDown.current, event.clientX, event.clientY);

  const toggleFold = (family: Xref, event: { clientX: number; clientY: number }): void => {
    if (!chose(event)) return;
    const before = layout.unions.get(family);
    if (before !== undefined) {
      pinned.current = { family, ...toScreen(view.current, before) };
    }
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(family)) next.add(family);
      return next;
    });
  };

  /**
   * Enter and Space activate a node, which is what they do on a button.
   *
   * `preventDefault` stops Space from scrolling the page out from under the selection, and
   * `stopPropagation` keeps the activation from also reaching the stage as a pan gesture.
   */
  const onActivate =
    (act: () => void) =>
    (event: ReactKeyboardEvent<SVGGElement>): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      act();
    };

  return (
    <svg
      ref={stageRef}
      className="chart-stage"
      /* `group`, not `img`. An image has no interior as far as assistive technology is concerned,
         so every person inside it was unreachable -- and since the record panel opens only from a
         node, that made the editor's whole purpose mouse-only. */
      role="group"
      aria-label={`Family tree: ${String(scene.persons.length)} people`}
    >
      <g ref={sceneRef}>
        <g className="links">
          {scene.connectors.map((connector) => (
            <path key={connector.id} className={`link ${connector.kind}`} d={connector.d} />
          ))}
        </g>

        <g className="nodes">
          {scene.persons.map((person) => (
            <g
              key={person.id}
              className={`person${person.sex === undefined ? '' : ` sex-${person.sex}`}`}
              data-id={person.id}
              role="button"
              tabIndex={0}
              /* Spoken from the caption, not from the marks: ♀ and † are read out as "female
                 sign" and "dagger", which describes the drawing rather than the person. */
              aria-label={person.caption}
              onClick={(event) => {
                if (chose(event)) onSelectPerson?.(person.id);
              }}
              onKeyDown={onActivate(() => {
                onSelectPerson?.(person.id);
              })}
            >
              {/* On the group, not on the text: the whole box is what a reader points at, and a
                  title inside the text would also become part of its content. */}
              <title>{person.name}</title>
              <rect
                className="box"
                x={person.x}
                y={person.y}
                width={person.width}
                height={person.height}
                rx={4}
              />
              <text className="name" x={person.x + person.width / 2} y={person.y + 24}>
                {person.label}
              </text>
              {person.marks === '' ? null : (
                <text className="marks" x={person.x + person.width / 2} y={person.y + 42}>
                  {person.marks}
                </text>
              )}
            </g>
          ))}

          {scene.unions.map((union) => (
            <g key={union.id}>
              <g
                className="union-node"
                data-id={union.id}
                role="button"
                tabIndex={0}
                aria-label={
                  union.ordinal > 0
                    ? `Union ${displayXref(union.id)}, marriage ${String(union.ordinal)}`
                    : `Union ${displayXref(union.id)}`
                }
                onClick={(event) => {
                  if (chose(event)) onSelectUnion?.(union.id);
                }}
                onKeyDown={onActivate(() => {
                  onSelectUnion?.(union.id);
                })}
              >
                <circle className="hit" cx={union.x} cy={union.y} r={11} />
                <circle className="union" cx={union.x} cy={union.y} r={5} />
                {/* The same `(n)` the descents below carry: one number, said in both places, so a
                    reader need not follow a line down to a child to learn which marriage they are
                    looking at.

                    Centred on the dot rather than set off to one side of it. Offset, it floated
                    diagonally away from the union it belongs to and read as a mark on nothing;
                    over the dot, the drop from the run leads the eye straight down to what it
                    names. Its height is the scene's -- see `ordinalY`. */}
                {union.ordinal > 0 ? (
                  <text className="ordinal union-ordinal" x={union.x} y={union.ordinalY}>
                    {`(${String(union.ordinal)})`}
                  </text>
                ) : null}
              </g>

              {union.foldable ? (
                <g
                  className={`toggle${union.collapsed ? ' shut' : ''}`}
                  data-control=""
                  data-fam={union.id}
                  data-cx={union.x}
                  data-cy={union.y}
                  role="button"
                  tabIndex={0}
                  aria-expanded={!union.collapsed}
                  aria-label={
                    union.collapsed
                      ? `Expand the branch below ${displayXref(union.id)}`
                      : `Collapse the branch below ${displayXref(union.id)}`
                  }
                  onClick={(event) => {
                    toggleFold(union.id, event);
                  }}
                  onKeyDown={onActivate(() => {
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (!next.delete(union.id)) next.add(union.id);
                      return next;
                    });
                  })}
                >
                  <rect
                    className="hit"
                    x={union.x - 13}
                    y={union.y + 6}
                    width={26}
                    height={26}
                  />
                  <rect
                    className="box"
                    x={union.x - 8}
                    y={union.y + 11}
                    width={16}
                    height={16}
                    rx={2}
                  />
                  <path
                    className="sign"
                    d={`M${union.x - 4},${union.y + 19} H${union.x + 4}`}
                  />
                  {union.collapsed ? (
                    <path className="sign" d={`M${union.x},${union.y + 15} V${union.y + 23}`} />
                  ) : null}
                  {union.collapsed && union.hiding > 0 ? (
                    <text className="hiding" x={union.x} y={union.y + 44}>
                      {`+${String(union.hiding)}`}
                    </text>
                  ) : null}
                  <title>
                    {union.collapsed
                      ? `Show ${String(union.hiding)} hidden`
                      : 'Fold this branch away'}
                  </title>
                </g>
              ) : null}
            </g>
          ))}

          {scene.ordinals.map((mark) => (
            <text key={mark.id} className="ordinal" x={mark.x} y={mark.y}>
              {mark.text}
            </text>
          ))}
        </g>
      </g>
    </svg>
  );
}
