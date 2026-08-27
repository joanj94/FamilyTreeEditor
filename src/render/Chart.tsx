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

import { GEOMETRY, computeLayout } from '../layout/layout.js';
import { GUTTER, buildScene, displayXref, type Connector } from './scene.js';
import { useT } from '../i18n/context.js';
import {
  beginDrag,
  centreOn,
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
import type { Lineage } from '../model/lineage.js';
import type { GedcomDoc, Xref } from '../model/types.js';

import './chart.css';

export interface ChartProps {
  readonly doc: GedcomDoc;
  /** Raised when a person is chosen. The chart selects nothing itself; that is the editor's. */
  readonly onSelectPerson?: (xref: Xref) => void;
  readonly onSelectUnion?: (xref: Xref) => void;
  /**
   * The selected person's line, drawn in bold. Null draws the chart plain.
   *
   * Computed by the editor rather than here, for the reason every other decision about *what is
   * true* is: `render/` reads a ViewModel and decides nothing. See `model/lineage.ts`.
   */
  readonly lineage?: Lineage | null;
  /**
   * Somebody to bring into view, wrapped so that asking twice is two askings.
   *
   * **The object identity is the signal, not the identifier.** Panning the chart to whatever is
   * selected would be intolerable -- every click on a box would drag the drawing out from under
   * the hand that clicked it -- so this is deliberately not the selection. The editor sets a
   * fresh object only when the reader has asked to be taken somewhere, which today means the
   * search box, and searching for the same person twice really should centre on them twice.
   */
  readonly reveal?: { readonly xref: Xref } | null;
}

/** How far out the chart opens. Close enough to read, far enough to see a family at once. */
const OPENS_AT_SCALE = 0.75;

/**
 * Where the chart opens.
 *
 * The left-hand margin holds the generation number as well as air, so it is measured from the
 * gutter rather than picked: opened at the plain 40 it always was, the leftmost column of numbers
 * was drawn off the edge of the stage and only appeared once the reader panned right -- which is
 * the one direction a reader starting at the top-left of a family has no reason to go.
 */
const OPENS_AT: Viewport = { scale: OPENS_AT_SCALE, tx: 40 + GUTTER * OPENS_AT_SCALE, ty: 90 };

export function Chart({
  doc,
  onSelectPerson,
  onSelectUnion,
  lineage = null,
  reveal = null,
}: ChartProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<Xref>>(() => new Set<Xref>());
  /* The last reveal that has been acted on, so a prop that has not changed is not acted on twice.
     See the block below the layout, which is where it is used. */
  const [answered, setAnswered] = useState<ChartProps['reveal']>(null);
  const t = useT();

  const layout = useMemo(() => computeLayout(doc, { collapsed }), [doc, collapsed]);
  /* `t` is a dependency because the spoken caption of every box is built from it, so a change of
     language rebuilds the scene rather than leaving the old language on the labels. */
  const scene = useMemo(
    () => buildScene(doc, layout, t, collapsed),
    [doc, layout, t, collapsed],
  );

  /**
   * Somebody who has been asked for, but is folded away, is unfolded to.
   *
   * A person inside a collapsed branch has no position, so there is nowhere to pan to -- and a
   * search that silently did nothing would be the worst possible answer, since the reader has
   * just been told this person exists. So the folds come off, and the pan below happens on the
   * layout that comes back.
   *
   * **Adjusted during the render rather than in an effect**, which is React's own answer to "a
   * prop changed and some state has to change with it": the re-render happens before anything is
   * painted, so the reader never sees the folded chart flash past on the way to the unfolded one.
   * Doing it in an effect is the cascading-render mistake the lint rules refuse, and it would
   * show.
   */
  if (reveal !== null && reveal !== answered) {
    setAnswered(reveal);
    if (!layout.positions.has(reveal.xref) && collapsed.size > 0) setCollapsed(new Set<Xref>());
  }

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
   * Take the reader to somebody they asked for.
   *
   * A layout effect rather than an effect, so the chart is already at the person on the frame it
   * first draws them: done afterwards, the reader sees the old view for a frame and the chart
   * jumps, which reads as a glitch rather than as an answer.
   *
   * It runs again whenever the layout changes, which is how a reveal into a folded branch lands:
   * the block above takes the folds off, and the position exists on the pass after that. Somebody
   * with no position even then is genuinely not drawn, and nothing moves.
   */
  useLayoutEffect(() => {
    if (reveal === null) return;
    const at = layout.positions.get(reveal.xref);
    const stage = stageRef.current;
    if (at === undefined || stage === null) return;
    const box = stage.getBoundingClientRect();
    view.current = centreOn(
      view.current,
      { x: layout.centres.get(reveal.xref) ?? at.x, y: at.y + GEOMETRY.nodeH / 2 },
      box,
    );
    apply();
  }, [reveal, layout, apply]);

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

  /**
   * Whether a run is part of the selected person's line.
   *
   * Both its ends have to be: the union it leaves and, where it has one, the person it reaches.
   * Without the second half every sibling's descent out of a lit parent family would light up
   * too, and a chart that draws your brothers as your ancestors is worse than one that draws
   * nothing.
   */
  const inLine = (connector: Connector): boolean =>
    lineage !== null &&
    lineage.families.has(connector.family) &&
    (connector.person === undefined || lineage.people.has(connector.person));

  return (
    <svg
      ref={stageRef}
      className="chart-stage"
      /* `group`, not `img`. An image has no interior as far as assistive technology is concerned,
         so every person inside it was unreachable -- and since the record panel opens only from a
         node, that made the editor's whole purpose mouse-only. */
      role="group"
      aria-label={t('chart.stage', {
        people: t('bar.people', { count: scene.persons.length }),
      })}
    >
      <g ref={sceneRef}>
        {/* First, so everything else is drawn over it: this is a scale beside the chart, not part
            of the family. It sits in the scene group and pans with it -- pinned to the viewport
            instead, the numbers would slide along the rows and stop naming them the moment the
            chart was dragged sideways. */}
        <g className="generations">
          {scene.generations.map((mark) => (
            <g key={mark.id}>
              <text
                className="generation"
                x={mark.x}
                y={mark.y}
                /* Spoken once. The number is repeated at the other end of the row so a reader who
                   has panned to the right-hand edge of a wide family can still see it, and a
                   screen reader saying "Generation 3" twice per row would only be noise. */
                aria-label={t('chart.generation', { n: mark.generation })}
              >
                {mark.generation}
              </text>
              <text className="generation at-end" x={mark.rightX} y={mark.y} aria-hidden="true">
                {mark.generation}
              </text>
            </g>
          ))}
        </g>

        {/* Two layers, the line's own drawn second. SVG paints in document order and the runs
            are one list, so in a single group an ordinary connector that happens to come later
            crosses the bold one and cuts a notch out of it -- which on a genealogy chart reads as
            a relationship that does not connect. */}
        <g className="links">
          {scene.connectors
            .filter((connector) => !inLine(connector))
            .map((connector) => (
              <path key={connector.id} className={`link ${connector.kind}`} d={connector.d} />
            ))}
        </g>
        <g className="links">
          {scene.connectors.filter(inLine).map((connector) => (
            <path key={connector.id} className={`link ${connector.kind} lit`} d={connector.d} />
          ))}
        </g>

        <g className="nodes">
          {scene.persons.map((person) => (
            <g
              key={person.id}
              className={[
                'person',
                person.sex === undefined ? '' : `sex-${person.sex}`,
                lineage?.people.has(person.id) === true ? 'lit' : '',
              ]
                .filter((part) => part !== '')
                .join(' ')}
              data-id={person.id}
              role="button"
              tabIndex={0}
              /* Spoken from the caption, not from the marks: ♀ and † are read out as "female
                 sign" and "dagger", which describes the drawing rather than the person.

                 The bold is said as well as drawn. A weight is nothing at all to a screen
                 reader, so the one fact the chart is making of the selection would otherwise
                 reach only the readers who can see it. */
              aria-label={
                lineage?.people.has(person.id) === true
                  ? `${person.caption}, ${t('chart.inLine')}`
                  : person.caption
              }
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
                className={`union-node${lineage?.families.has(union.id) === true ? ' lit' : ''}`}
                data-id={union.id}
                role="button"
                tabIndex={0}
                aria-label={[
                  union.ordinal > 0
                    ? t('chart.unionMarriage', {
                        xref: displayXref(union.id),
                        n: union.ordinal,
                      })
                    : t('chart.union', { xref: displayXref(union.id) }),
                  // In words, never as the signs the dot is drawn with -- see `caption`.
                  union.caption,
                ]
                  .filter((part) => part !== '')
                  .join(', ')}
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
                {/* What the couple themselves say: `=` and `≠` with the year of each. Beside the dot
                    rather than under it, because the fold hangs there -- see `marksX`. */}
                {union.marks === '' ? null : (
                  <text className="union-marks" x={union.marksX} y={union.marksY}>
                    {union.marks}
                  </text>
                )}
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
                      ? t('chart.expand', { xref: displayXref(union.id) })
                      : t('chart.collapse', { xref: displayXref(union.id) })
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
                      ? t('chart.showHidden', { count: union.hiding })
                      : t('chart.fold')}
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
