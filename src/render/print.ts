/**
 * The chart, on paper.
 *
 * **This prints the drawing that is on screen, not a fresh one built from the document.** The
 * chart's viewport lives outside React on purpose -- see `Chart.tsx` -- and so do the folds a
 * reader has closed and the line they have lit up. The DOM is therefore the only place where
 * *what is currently visible* exists in one piece, so printing clones it. Rebuilding the scene
 * from the document instead would quietly print a different chart from the one the reader was
 * looking at when they pressed the button, which is the one outcome a print feature must not have.
 *
 * The clone is stripped of the things that are screen and not drawing: the invisible hit targets,
 * the counter-scaled fold controls, the focus order. What survives is the drawing, and it keeps
 * its classes, so `chart.css` styles it on paper exactly as it does on screen.
 *
 * **Each page is an SVG whose user unit is one millimetre.** `width="297mm"` with
 * `viewBox="0 0 297 210"` makes the arithmetic in `paper.ts` land directly on the page: the
 * margins are millimetres, the trim is millimetres, and the drawing is put inside a single
 * `scale(mmPerUnit)` that turns layout units into them. Nothing has to be converted twice.
 *
 * The whole printout lives outside React, appended to the body for the duration of the print and
 * removed afterwards. React never renders it, so React cannot be surprised by it, and a print that
 * is cancelled leaves the page exactly as it found it.
 */
import type { Plan, Sheet } from './paper.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The class the printout is found by, both in CSS and when clearing a previous one away. */
export const PRINTOUT_CLASS = 'printout';

/** How a sheet says which sheet it is. Passed in, so this module stays free of any language. */
export type SheetLabel = (sheet: Sheet, plan: Plan) => string;

export type PrintOutcome =
  { readonly outcome: 'printed' } | { readonly outcome: 'failed'; readonly problem: string };

/** Make an SVG element with its attributes, which is otherwise four lines every time. */
function svg<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  name: K,
  attributes: Readonly<Record<string, string | number>>,
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/**
 * The drawing as it currently stands, ready to be put on a page.
 *
 * The viewport transform goes first: it is where the reader has panned to, which is a fact about
 * a window rather than about the family, and the page has its own.
 *
 * Then the chrome. The fold controls carry an inline transform that counter-scales them against
 * the zoom -- and an inline `display: none` when the chart is zoomed far enough out that they are
 * hidden -- neither of which means anything on paper; worse, that `display` would silently take
 * the "+3 hidden" marks off a printed chart because of where the reader happened to have zoomed
 * to. The box and the plus sign are a control and go; the count they sit above is information
 * about the family and stays.
 */
export function cloneScene(source: SVGSVGElement): SVGGElement | null {
  const group = source.querySelector('g');
  if (group === null) return null;
  const clone = group.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform');

  for (const control of clone.querySelectorAll<SVGGElement>('[data-control]')) {
    control.removeAttribute('transform');
    control.style.removeProperty('display');
    for (const part of control.querySelectorAll('.box, .sign, .hit')) part.remove();
  }
  // Invisible targets sized for a finger. There are no fingers on paper.
  for (const hit of clone.querySelectorAll('.hit')) hit.remove();
  // A printed page has no focus order and nothing to activate.
  for (const node of clone.querySelectorAll('[tabindex]')) node.removeAttribute('tabindex');
  for (const node of clone.querySelectorAll('[role]')) node.removeAttribute('role');

  return clone;
}

/**
 * The one rule that decides what size paper the browser asks for.
 *
 * `margin: 0` because the margins are already inside the drawing -- see `paper.ts`. Letting the
 * browser add its own on top would inset a page that is already inset, and on a tiled chart every
 * sheet would come out at a slightly different scale from the one the tiling was computed for,
 * which is exactly the fault that makes taped-together sheets not line up.
 */
export function pageRule(plan: Plan): string {
  return `@page { size: ${plan.page.w.toFixed(2)}mm ${plan.page.h.toFixed(2)}mm; margin: 0; }`;
}

/** One page: the slice of drawing, clipped to the ink area, with its trim and its number. */
function buildPage(
  doc: Document,
  scene: SVGGElement,
  plan: Plan,
  sheet: Sheet,
  label: SheetLabel,
): HTMLElement {
  const { page, margin, mmPerUnit } = plan;
  const ink = { w: page.w - 2 * margin, h: page.h - 2 * margin };
  const tiled = plan.sheets.length > 1;

  const holder = doc.createElement('div');
  holder.className = 'print-page';
  holder.style.width = `${String(page.w)}mm`;
  holder.style.height = `${String(page.h)}mm`;

  const sheetSvg = svg(doc, 'svg', {
    class: 'print-sheet',
    xmlns: SVG_NS,
    width: `${page.w.toFixed(2)}mm`,
    height: `${page.h.toFixed(2)}mm`,
    viewBox: `0 0 ${page.w.toFixed(3)} ${page.h.toFixed(3)}`,
  });

  const clipId = `print-clip-${String(sheet.index)}`;
  const defs = svg(doc, 'defs', {});
  const clip = svg(doc, 'clipPath', { id: clipId });
  clip.append(svg(doc, 'rect', { x: margin, y: margin, width: ink.w, height: ink.h }));
  defs.append(clip);
  sheetSvg.append(defs);

  // The paper is white whatever the reader's browser is themed as.
  sheetSvg.append(
    svg(doc, 'rect', { class: 'print-paper', x: 0, y: 0, width: page.w, height: page.h }),
  );

  const clipped = svg(doc, 'g', { 'clip-path': `url(#${clipId})` });
  /* Read right to left: put the top-left of this sheet's slice at the origin, turn layout units
     into millimetres, then move the whole thing inside the margin. */
  const placed = svg(doc, 'g', {
    transform:
      `translate(${String(margin)},${String(margin)}) ` +
      `scale(${String(mmPerUnit)}) ` +
      `translate(${String(-sheet.view.x)},${String(-sheet.view.y)})`,
  });
  placed.append(scene);
  clipped.append(placed);
  sheetSvg.append(clipped);

  if (tiled) {
    /* Where to cut, and what to cut off. Neighbouring sheets share `OVERLAP` millimetres of
       drawing, so a cut anywhere near this line loses nothing -- the line says where the sheets
       were meant to meet, not where they must. */
    sheetSvg.append(
      svg(doc, 'rect', {
        class: 'print-trim',
        x: margin,
        y: margin,
        width: ink.w,
        height: ink.h,
      }),
    );
    /* In the margin rather than on the drawing: it is a note to whoever is taping the sheets up,
       and it must not be part of the chart once they have. */
    const tag = svg(doc, 'text', {
      class: 'print-tag',
      x: page.w / 2,
      y: page.h - margin / 3,
    });
    tag.textContent = label(sheet, plan);
    sheetSvg.append(tag);
  }

  holder.append(sheetSvg);
  return holder;
}

/**
 * Every page of the plan, as one detached element.
 *
 * `aria-hidden`, because this is a copy of a chart that is already on the page and already
 * described: a screen reader meeting both would read the whole family twice.
 */
export function buildPrintout(
  source: SVGSVGElement,
  plan: Plan,
  label: SheetLabel,
): HTMLElement | null {
  const doc = source.ownerDocument;
  const scene = cloneScene(source);
  if (scene === null) return null;

  const root = doc.createElement('div');
  root.className = PRINTOUT_CLASS;
  root.setAttribute('aria-hidden', 'true');

  for (const sheet of plan.sheets) {
    /* Each page gets its own copy. One node cannot be in two places, and a tiled chart is the
       same drawing looked at through several windows. */
    root.append(buildPage(doc, scene.cloneNode(true) as SVGGElement, plan, sheet, label));
  }
  return root;
}

export interface PrintRequest {
  /** The chart as it stands on screen. */
  readonly source: SVGSVGElement;
  readonly plan: Plan;
  readonly label: SheetLabel;
  /** The window to print. Named so a test can hand in one that does not open a dialog. */
  readonly view: Window;
}

/**
 * Put the chart on paper.
 *
 * The printout and its `@page` rule go into the document, the browser's own print dialog opens,
 * and both come out again when it closes. Nothing is left behind on a cancelled print, because
 * `afterprint` fires either way -- and the cleanup is registered before `print()` rather than
 * after it, since in most browsers `print()` does not return until the dialog is done with.
 */
export function printChart({ source, plan, label, view }: PrintRequest): PrintOutcome {
  const doc = source.ownerDocument;
  // Defensive: a previous print that was interrupted before its cleanup ran.
  for (const stale of doc.querySelectorAll(`.${PRINTOUT_CLASS}, style[data-print]`)) {
    stale.remove();
  }

  const root = buildPrintout(source, plan, label);
  if (root === null) return { outcome: 'failed', problem: 'the chart has nothing drawn on it' };

  const style = doc.createElement('style');
  style.setAttribute('data-print', '');
  style.textContent = pageRule(plan);

  doc.head.append(style);
  doc.body.append(root);

  const clear = (): void => {
    style.remove();
    root.remove();
    view.removeEventListener('afterprint', clear);
  };
  view.addEventListener('afterprint', clear);

  try {
    view.print();
  } catch (problem) {
    /* Never leave the printout behind on a failure: it is `display: none` on screen, but it is a
       second copy of the whole chart sitting in the document. */
    clear();
    return {
      outcome: 'failed',
      problem: problem instanceof Error ? problem.message : String(problem),
    };
  }
  return { outcome: 'printed' };
}
