// @vitest-environment jsdom
/**
 * The printout, built and inspected.
 *
 * jsdom has no layout and no printer, so what is asserted here is what the printout *is* rather
 * than what it looks like: that the drawing on screen is the drawing that goes on the page, that
 * the screen's own chrome does not, that each sheet is placed by the arithmetic `paper.ts`
 * computed, and that a print leaves nothing behind in the document afterwards.
 *
 * The last of those is the one worth having a test for. The printout is a second complete copy of
 * the chart; left in the DOM after a cancelled print it is invisible, harmless-looking, and would
 * be found weeks later as a page that has quietly doubled in size.
 *
 * Values are structural placeholders. No real genealogy data enters this repository.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { planPrint, type Plan } from './paper.js';
import {
  PRINTOUT_CLASS,
  buildPrintout,
  cloneScene,
  pageRule,
  printChart,
  type SheetLabel,
} from './print.js';
import type { Bounds } from './scene.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A chart as the DOM holds one: a stage, a scene group carrying a viewport transform, a person,
 * and the two kinds of thing that are screen rather than drawing -- a hit target and a fold
 * control, the control counter-scaled and hidden the way `apply()` leaves it when zoomed out.
 */
function stage(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chart-stage');
  svg.innerHTML = `
    <g transform="translate(120,90) scale(0.75)">
      <g class="nodes">
        <g class="person" data-id="@I1@" role="button" tabindex="0">
          <rect class="box" x="0" y="0" width="150" height="58"></rect>
          <text class="name" x="75" y="24">GivenA SurnameB</text>
        </g>
        <g class="union-node" data-id="@F1@" role="button" tabindex="0">
          <circle class="hit" cx="80" cy="100" r="11"></circle>
          <circle class="union" cx="80" cy="100" r="5"></circle>
        </g>
        <g class="toggle shut" data-control="" data-fam="@F1@" data-cx="80" data-cy="100"
           role="button" tabindex="0" transform="translate(80,100) scale(2) translate(-80,-100)"
           style="display: none">
          <rect class="hit" x="67" y="106" width="26" height="26"></rect>
          <rect class="box" x="72" y="111" width="16" height="16"></rect>
          <path class="sign" d="M76,119 H84"></path>
          <text class="hiding" x="80" y="144">+3</text>
        </g>
      </g>
    </g>`;
  document.body.append(svg);
  return svg;
}

const bounds: Bounds = { minX: 0, minY: 0, width: 1200, height: 500 };
const label: SheetLabel = (sheet, plan) =>
  `Sheet ${String(sheet.index)} of ${String(plan.sheets.length)}`;

const onA3 = (): Plan =>
  planPrint(bounds, { paper: 'A3', orientation: 'landscape', fit: 'sheet' });
const tiledOnA4 = (): Plan =>
  planPrint(bounds, { paper: 'A4', orientation: 'landscape', fit: 'tiles' });

afterEach(() => {
  document.body.innerHTML = '';
  for (const node of document.head.querySelectorAll('style[data-print]')) node.remove();
});

describe('cloning what is on screen', () => {
  it('takes the drawing without the viewport it happens to be seen through', () => {
    const clone = cloneScene(stage());
    expect(clone).not.toBeNull();
    expect(clone?.getAttribute('transform')).toBeNull();
    expect(clone?.querySelector('.person .name')?.textContent).toBe('GivenA SurnameB');
  });

  it('leaves the invisible targets behind, since there is nothing to point at on paper', () => {
    const clone = cloneScene(stage());
    expect(clone?.querySelectorAll('.hit')).toHaveLength(0);
    expect(clone?.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(clone?.querySelectorAll('[role]')).toHaveLength(0);
  });

  it('drops the fold control but keeps the count it was hiding', () => {
    /* The plus box is a control. "+3" is a statement about the family, and a printed chart that
       silently omitted three people would be wrong rather than merely plainer. */
    const control = cloneScene(stage())?.querySelector<SVGGElement>('[data-control]');
    expect(control?.querySelector('.box')).toBeNull();
    expect(control?.querySelector('.sign')).toBeNull();
    expect(control?.querySelector('.hiding')?.textContent).toBe('+3');
  });

  it('undoes the counter-scale and the hiding the zoom left on the control', () => {
    const control = cloneScene(stage())?.querySelector<SVGGElement>('[data-control]');
    expect(control?.getAttribute('transform')).toBeNull();
    expect(control?.style.display).toBe('');
  });

  it('answers with nothing where the chart has nothing drawn', () => {
    const empty = document.createElementNS(SVG_NS, 'svg');
    expect(cloneScene(empty)).toBeNull();
  });
});

describe('asking the browser for a size of paper', () => {
  it('names the page in millimetres and takes no margin of its own', () => {
    /* The margins are already inside the drawing. A browser margin on top would inset an inset
       page and print every tile at a scale the tiling was not computed for. */
    expect(pageRule(onA3())).toBe('@page { size: 420.00mm 297.00mm; margin: 0; }');
  });

  it('asks for the roll it was planned as, however long that is', () => {
    const rule = pageRule(
      planPrint(bounds, { paper: 'A1', orientation: 'landscape', fit: 'roll' }),
    );
    expect(rule).toContain('594.00mm;');
  });
});

describe('building the pages', () => {
  it('makes one page per sheet in the plan', () => {
    const plan = tiledOnA4();
    const printout = buildPrintout(stage(), plan, label);
    expect(plan.sheets.length).toBeGreaterThan(1);
    expect(printout?.querySelectorAll('.print-page')).toHaveLength(plan.sheets.length);
  });

  it('sizes each page in millimetres and gives it a viewBox to match', () => {
    const page = buildPrintout(stage(), onA3(), label)?.querySelector('svg');
    expect(page?.getAttribute('width')).toBe('420.00mm');
    expect(page?.getAttribute('height')).toBe('297.00mm');
    expect(page?.getAttribute('viewBox')).toBe('0 0 420.000 297.000');
  });

  it('places the slice so its corner lands on the margin, at the planned scale', () => {
    const plan = onA3();
    const sheet = plan.sheets[0];
    const placed = buildPrintout(stage(), plan, label)?.querySelector('[clip-path] > g');
    expect(placed?.getAttribute('transform')).toBe(
      `translate(${String(plan.margin)},${String(plan.margin)}) ` +
        `scale(${String(plan.mmPerUnit)}) ` +
        `translate(${String(-(sheet?.view.x ?? 0))},${String(-(sheet?.view.y ?? 0))})`,
    );
  });

  it('clips each page to its ink area, so one tile does not print its neighbour', () => {
    const plan = tiledOnA4();
    const clip = buildPrintout(stage(), plan, label)?.querySelector('clipPath rect');
    expect(clip?.getAttribute('width')).toBe(String(plan.page.w - 2 * plan.margin));
    expect(clip?.getAttribute('height')).toBe(String(plan.page.h - 2 * plan.margin));
  });

  it('carries the whole drawing onto every tile, seen through a different window each time', () => {
    const printout = buildPrintout(stage(), tiledOnA4(), label);
    for (const page of printout?.querySelectorAll('.print-page') ?? []) {
      expect(page.querySelector('.person .name')?.textContent).toBe('GivenA SurnameB');
    }
  });

  it('marks the trim and numbers the sheet, but only where there is more than one', () => {
    const tiled = buildPrintout(stage(), tiledOnA4(), label);
    expect(tiled?.querySelector('.print-trim')).not.toBeNull();
    expect(tiled?.querySelector('.print-tag')?.textContent).toMatch(/^Sheet 1 of \d+$/);

    const single = buildPrintout(stage(), onA3(), label);
    expect(single?.querySelector('.print-trim')).toBeNull();
    expect(single?.querySelector('.print-tag')).toBeNull();
  });

  it('hides itself from a screen reader, which is already being read the chart itself', () => {
    expect(buildPrintout(stage(), onA3(), label)?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('printing', () => {
  let printing: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    printing = vi.fn();
    // jsdom has no `print`. What matters is that it is called once, with the pages in place.
    Object.defineProperty(window, 'print', {
      value: printing,
      configurable: true,
      writable: true,
    });
  });

  it('puts the pages and the page rule into the document, then prints', () => {
    printing.mockImplementation(() => {
      expect(document.querySelectorAll(`.${PRINTOUT_CLASS}`)).toHaveLength(1);
      expect(document.head.querySelector('style[data-print]')?.textContent).toContain('@page');
    });
    const outcome = printChart({ source: stage(), plan: onA3(), label, view: window });
    expect(outcome).toEqual({ outcome: 'printed' });
    expect(printing).toHaveBeenCalledTimes(1);
  });

  it('takes them out again when the dialog closes, cancelled or not', () => {
    printChart({ source: stage(), plan: onA3(), label, view: window });
    expect(document.querySelectorAll(`.${PRINTOUT_CLASS}`)).toHaveLength(1);
    window.dispatchEvent(new Event('afterprint'));
    expect(document.querySelectorAll(`.${PRINTOUT_CLASS}`)).toHaveLength(0);
    expect(document.head.querySelector('style[data-print]')).toBeNull();
  });

  it('clears a printout an interrupted print left behind rather than adding a second', () => {
    printChart({ source: stage(), plan: onA3(), label, view: window });
    printChart({ source: stage(), plan: onA3(), label, view: window });
    expect(document.querySelectorAll(`.${PRINTOUT_CLASS}`)).toHaveLength(1);
    expect(document.head.querySelectorAll('style[data-print]')).toHaveLength(1);
  });

  it('leaves nothing behind when printing itself fails, and says what went wrong', () => {
    printing.mockImplementation(() => {
      throw new Error('no printer');
    });
    const outcome = printChart({ source: stage(), plan: onA3(), label, view: window });
    expect(outcome).toEqual({ outcome: 'failed', problem: 'no printer' });
    expect(document.querySelectorAll(`.${PRINTOUT_CLASS}`)).toHaveLength(0);
    expect(document.head.querySelector('style[data-print]')).toBeNull();
  });

  it('refuses a chart with nothing drawn on it instead of printing a blank page', () => {
    const empty = document.createElementNS(SVG_NS, 'svg');
    document.body.append(empty);
    const outcome = printChart({ source: empty, plan: onA3(), label, view: window });
    expect(outcome.outcome).toBe('failed');
    expect(printing).not.toHaveBeenCalled();
  });
});
