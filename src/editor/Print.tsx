/**
 * The print button, and the paper it opens onto.
 *
 * **The paper is suggested, not demanded.** A reader looking at a family tree has no way of
 * knowing whether it is an A3 job or an A0 one -- the chart is zoomed to whatever they last
 * dragged it to, and the size on screen says nothing about the size on paper. So the chooser
 * opens on the smallest sheet the whole chart fits on with its names still readable, computed
 * from the drawing itself in `render/paper.ts`, and every control is a way of overriding that
 * rather than a question that has to be answered first.
 *
 * **It stays a suggestion for as long as the reader has not overridden one.** `picked` is null
 * until something is chosen, and the choice in force is the suggestion until then -- so folding a
 * branch away, or opening a different file, re-suggests. A suggestion copied into state on mount
 * would go stale the moment the chart changed, and would then be wrong in the most expensive
 * direction: silently, and only on paper.
 *
 * **Every consequence is on screen before anything is printed.** The size of paper, how many
 * sheets, how big the finished drawing is, and -- the one that matters -- how tall a name will be
 * printed. A chart reduced past readability is the failure this feature exists to prevent, and it
 * cannot be seen in a print preview thumbnail. It is said in millimetres instead.
 *
 * The chart itself is read out of the DOM rather than passed in, for the reason set out in
 * `render/print.ts`: the viewport, the folds and the lit line live outside React by design, so
 * the drawing on screen exists in one piece only in the document. `App` already reaches for a
 * node the same way to put focus back after Escape.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useT } from '../i18n/context.js';
import type { MessageKey } from '../i18n/keys.js';
import {
  FITS,
  MIN_TYPE_MM,
  OVERLAP,
  PAPERS,
  PAPER_NAMES,
  isEmpty,
  metres,
  mm,
  planPrint,
  suggest,
  type Choice,
  type Fit,
  type Orientation,
  type PaperName,
} from '../render/paper.js';
import { printChart } from '../render/print.js';
import type { Bounds } from '../render/scene.js';

export interface PrintProps {
  /**
   * What the chart currently occupies, in layout units, or null where nothing is drawn.
   *
   * Raised by the chart rather than recomputed here: it is the extent of the scene *as folded*,
   * and the folds are the chart's own state. See `Chart.onExtent`.
   */
  readonly bounds: Bounds | null;
}

/** Nothing drawn. A constant, so the memos below have a stable value to fall back on. */
const NOTHING: Bounds = { minX: 0, minY: 0, width: 0, height: 0 };

const ORIENTATIONS: readonly Orientation[] = ['landscape', 'portrait'];

const ORIENTATION_NAMES: Readonly<Record<Orientation, MessageKey>> = {
  portrait: 'print.portrait',
  landscape: 'print.landscape',
};

const FIT_NAMES: Readonly<Record<Fit, MessageKey>> = {
  sheet: 'print.fit.sheet',
  tiles: 'print.fit.tiles',
  roll: 'print.fit.roll',
};

export function Print({ bounds }: PrintProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  /** What the reader has chosen, or null while they are content with the suggestion. */
  const [picked, setPicked] = useState<Choice | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const first = useRef<HTMLSelectElement | null>(null);

  const drawn = bounds !== null && !isEmpty(bounds);
  const extent = bounds ?? NOTHING;
  const advised = useMemo(() => suggest(extent), [extent]);
  const choice = picked ?? advised;
  const plan = useMemo(
    () => (drawn ? planPrint(extent, choice) : null),
    [drawn, extent, choice],
  );

  /* Focus into the panel when it opens, so the chooser is usable without reaching for a mouse and
     so a screen reader is taken to what just appeared rather than left on the button. */
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  /* Clicking anywhere else puts the panel away. A popover that can only be closed by its own
     button is a panel the reader has to dispose of before they can go back to the chart. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && holder.current?.contains(target) === true) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const change = (part: Partial<Choice>): void => {
    setFailure(null);
    setPicked({ ...choice, ...part });
  };

  /**
   * Escape closes the panel and goes no further.
   *
   * The shell binds Escape on the window to close the record panel and throw focus back onto the
   * chart -- so without stopping it here, dismissing this panel would also close a record the
   * reader had open behind it. See the same reasoning in `Find`.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
  };

  const go = (): void => {
    /* The chart as drawn, taken from the document. See the module comment, and `render/print.ts`
       for why this is the source of truth rather than a rebuilt scene. */
    const source = document.querySelector<SVGSVGElement>('.chart-stage');
    if (source === null || plan === null) {
      setFailure(t('print.nothing'));
      return;
    }
    const outcome = printChart({
      source,
      plan,
      view: window,
      label: (sheet, printed) =>
        t('print.sheetTag', {
          index: sheet.index,
          total: printed.sheets.length,
          // 1-based on paper: nobody assembling sheets on a floor counts from zero.
          row: sheet.row + 1,
          column: sheet.column + 1,
        }),
    });
    if (outcome.outcome === 'failed') {
      setFailure(t('print.failed', { detail: outcome.problem }));
      return;
    }
    setFailure(null);
    setOpen(false);
  };

  /* Everything the plan costs, in one line: the paper, the sheets, the wall it makes, and the
     size a name comes out at. Built as a list and joined so a language may order it differently
     and so a part that does not apply -- a grid, on a single sheet -- simply is not there. */
  const summary =
    plan === null
      ? ''
      : [
          plan.choice.fit === 'roll'
            ? t('print.onRoll', {
                paper: plan.choice.paper,
                width: mm(plan.page.h),
                length: mm(plan.page.w),
              })
            : t('print.onSheet', {
                paper: plan.choice.paper,
                orientation: t(ORIENTATION_NAMES[plan.choice.orientation]),
                w: mm(plan.page.w),
                h: mm(plan.page.h),
              }),
          t('print.sheets', { count: plan.sheets.length }),
          ...(plan.across > 1 || plan.down > 1
            ? [t('print.grid', { across: plan.across, down: plan.down })]
            : []),
          t('print.finished', { w: metres(plan.finished.w), h: metres(plan.finished.h) }),
          t('print.type', { mm: mm(plan.typeMm) }),
        ].join(' · ');

  return (
    <div className="printing" ref={holder} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="print-open"
        title={t('print.title')}
        aria-expanded={open}
        aria-controls="print-options"
        disabled={!drawn}
        onClick={() => {
          setFailure(null);
          setOpen((was) => !was);
        }}
      >
        {t('print.open')}
      </button>

      {open && plan !== null ? (
        <div
          className="print-options"
          id="print-options"
          role="group"
          aria-label={t('print.heading')}
        >
          <label>
            <span>{t('print.paper')}</span>
            <select
              ref={first}
              value={choice.paper}
              onChange={(event) => {
                change({ paper: event.target.value as PaperName });
              }}
            >
              {PAPER_NAMES.map((paper) => (
                <option key={paper} value={paper}>
                  {t(paper === advised.paper ? 'print.paperSuggested' : 'print.paperOption', {
                    paper,
                    w: PAPERS[paper].w,
                    h: PAPERS[paper].h,
                  })}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>{t('print.fit')}</span>
            <select
              value={choice.fit}
              onChange={(event) => {
                change({ fit: event.target.value as Fit });
              }}
            >
              {FITS.map((fit) => (
                <option key={fit} value={fit}>
                  {t(FIT_NAMES[fit])}
                </option>
              ))}
            </select>
          </label>

          {/* Hidden rather than disabled on a roll: a roll has one width and cannot be turned, so
              the control would not be a choice the reader is being denied -- it would be a
              question that does not apply. */}
          {choice.fit === 'roll' ? null : (
            <label>
              <span>{t('print.orientation')}</span>
              <select
                value={choice.orientation}
                onChange={(event) => {
                  change({ orientation: event.target.value as Orientation });
                }}
              >
                {ORIENTATIONS.map((orientation) => (
                  <option key={orientation} value={orientation}>
                    {t(ORIENTATION_NAMES[orientation])}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Announced, because the whole line changes as the controls do and a reader who cannot
              see it changing would otherwise choose a paper without ever learning what it costs. */}
          <p className="print-summary" aria-live="polite">
            {summary}
          </p>

          {plan.typeMm < MIN_TYPE_MM ? (
            <p className="print-warn">{t('print.tooSmall', { min: MIN_TYPE_MM })}</p>
          ) : null}
          {plan.capped ? (
            <p className="print-warn">{t('print.capped', { length: mm(plan.page.w) })}</p>
          ) : null}
          {plan.choice.fit === 'roll' ? (
            <p className="print-note">{t('print.rollNote')}</p>
          ) : null}
          {plan.choice.fit === 'tiles' && plan.sheets.length > 1 ? (
            <p className="print-note">
              {t('print.tilesNote', {
                sheets: t('print.sheets', { count: plan.sheets.length }),
                overlap: OVERLAP,
              })}
            </p>
          ) : null}
          {failure === null ? null : <p className="print-warn">{failure}</p>}

          <p className="print-actions">
            <button type="button" className="print-go" onClick={go}>
              {t('print.go')}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t('print.close')}
            </button>
          </p>
        </div>
      ) : null}
    </div>
  );
}
