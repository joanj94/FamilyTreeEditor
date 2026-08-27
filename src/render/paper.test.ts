/**
 * The paper arithmetic, asserted without a printer.
 *
 * This is the half of printing that can be wrong silently: a plan that tiles into four hundred
 * sheets, a roll that comes back as a page no reader can open, a suggestion that sends somebody to
 * a copy shop for a chart that fits on A3. None of that shows up in a screenshot, and all of it is
 * arithmetic, so all of it is tested here rather than in front of a browser.
 *
 * Values are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import {
  MARGIN,
  MAX_PAGE_MM,
  MIN_TYPE_MM,
  MM_PER_UNIT,
  PAD,
  PAPERS,
  isEmpty,
  metres,
  mm,
  pageOf,
  planPrint,
  suggest,
  type Choice,
} from './paper.js';
import type { Bounds } from './scene.js';

/** A chart of a given size at the origin. */
const chart = (width: number, height: number): Bounds => ({
  minX: 0,
  minY: 0,
  width,
  height,
});

/** What the drawing occupies once the air around it is counted, which is what is fitted. */
const withPad = (bounds: Bounds): { w: number; h: number } => ({
  w: bounds.width + 2 * PAD,
  h: bounds.height + 2 * PAD,
});

describe('turning the paper', () => {
  it('gives the sheet as printed, not as catalogued', () => {
    expect(pageOf('A4', 'portrait')).toEqual({ w: 210, h: 297 });
    expect(pageOf('A4', 'landscape')).toEqual({ w: 297, h: 210 });
    expect(pageOf('A0', 'landscape')).toEqual({ w: 1189, h: 841 });
  });
});

describe('fitting onto one sheet', () => {
  it('scales the drawing until whichever side runs out first stops it', () => {
    /* A chart much wider than it is tall on a landscape sheet is stopped by the width, so the
       scale is the ink width over the padded drawing width and nothing else decides it. */
    const bounds = chart(2000, 400);
    const plan = planPrint(bounds, { paper: 'A3', orientation: 'landscape', fit: 'sheet' });
    const ink = 420 - 2 * MARGIN;
    expect(plan.mmPerUnit).toBeCloseTo(ink / withPad(bounds).w, 10);
    expect(plan.page).toEqual({ w: 420, h: 297 });
  });

  it('is one sheet however big the chart is', () => {
    const plan = planPrint(chart(90000, 12000), {
      paper: 'A4',
      orientation: 'portrait',
      fit: 'sheet',
    });
    expect(plan.sheets).toHaveLength(1);
    expect(plan.across).toBe(1);
    expect(plan.down).toBe(1);
  });

  it('centres what is left over rather than pushing the chart into one corner', () => {
    /* A drawing whose proportions do not match the page leaves slack on one axis. Split evenly,
       the middle of the slice is the middle of the drawing on both axes. */
    const bounds = chart(1000, 100);
    const plan = planPrint(bounds, { paper: 'A4', orientation: 'landscape', fit: 'sheet' });
    const view = plan.sheets[0]?.view;
    const area = withPad(bounds);
    expect(view).toBeDefined();
    expect((view?.x ?? 0) + (view?.w ?? 0) / 2).toBeCloseTo(-PAD + area.w / 2, 8);
    expect((view?.y ?? 0) + (view?.h ?? 0) / 2).toBeCloseTo(-PAD + area.h / 2, 8);
  });

  it('enlarges as readily as it reduces, because fit means fit', () => {
    const plan = planPrint(chart(200, 100), {
      paper: 'A0',
      orientation: 'landscape',
      fit: 'sheet',
    });
    expect(plan.mmPerUnit).toBeGreaterThan(MM_PER_UNIT);
    expect(plan.finished.w).toBeGreaterThan(1000);
  });

  it('reports the size a name is printed at, which is what says whether it is worth printing', () => {
    const small = planPrint(chart(400, 300), {
      paper: 'A3',
      orientation: 'landscape',
      fit: 'sheet',
    });
    const huge = planPrint(chart(60000, 4000), {
      paper: 'A3',
      orientation: 'landscape',
      fit: 'sheet',
    });
    expect(small.typeMm).toBeGreaterThan(MIN_TYPE_MM);
    expect(huge.typeMm).toBeLessThan(MIN_TYPE_MM);
  });
});

describe('tiling across ordinary sheets', () => {
  const tiled: Choice = { paper: 'A4', orientation: 'landscape', fit: 'tiles' };

  it('draws at natural size, so the paper decides the sheet count and nothing else', () => {
    const plan = planPrint(chart(4000, 1200), tiled);
    expect(plan.mmPerUnit).toBe(MM_PER_UNIT);
    const bigger = planPrint(chart(4000, 1200), { ...tiled, paper: 'A2' });
    expect(bigger.mmPerUnit).toBe(MM_PER_UNIT);
    expect(bigger.sheets.length).toBeLessThan(plan.sheets.length);
    // The finished drawing is the same wall either way. Only the number of sheets changed.
    expect(bigger.finished).toEqual(plan.finished);
  });

  it('is a single sheet when the chart already fits on one', () => {
    const plan = planPrint(chart(300, 200), tiled);
    expect(plan.across).toBe(1);
    expect(plan.down).toBe(1);
    expect(plan.sheets).toHaveLength(1);
  });

  it('numbers the sheets in reading order, which is the order they are taped in', () => {
    const plan = planPrint(chart(4000, 1500), tiled);
    expect(plan.sheets).toHaveLength(plan.across * plan.down);
    expect(plan.sheets.map((sheet) => sheet.index)).toEqual(
      plan.sheets.map((_sheet, index) => index + 1),
    );
    for (const sheet of plan.sheets) {
      expect(sheet.index).toBe(sheet.row * plan.across + sheet.column + 1);
    }
  });

  it('covers the whole drawing, edge to edge', () => {
    const bounds = chart(4000, 1500);
    const plan = planPrint(bounds, tiled);
    const area = withPad(bounds);
    const last = plan.sheets[plan.sheets.length - 1];
    expect(plan.sheets[0]?.view.x).toBeCloseTo(-PAD, 8);
    expect(plan.sheets[0]?.view.y).toBeCloseTo(-PAD, 8);
    expect((last?.view.x ?? 0) + (last?.view.w ?? 0)).toBeCloseTo(-PAD + area.w, 6);
    expect((last?.view.y ?? 0) + (last?.view.h ?? 0)).toBeCloseTo(-PAD + area.h, 6);
  });

  it('overlaps neighbours, so a cut that misses the line loses nothing', () => {
    const plan = planPrint(chart(4000, 1500), tiled);
    const first = plan.sheets[0];
    const second = plan.sheets[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const shared = (first?.view.x ?? 0) + (first?.view.w ?? 0) - (second?.view.x ?? 0);
    expect(shared).toBeGreaterThan(0);
  });

  it('shares the overlap out evenly instead of dumping it on the last tile', () => {
    /* A fixed step leaves whatever is left over as the final column's overlap, which on an
       awkward width is nearly a whole repeated sheet. Every gap being equal is the assertion
       that it was divided rather than accumulated. */
    const plan = planPrint(chart(3733, 900), tiled);
    const row = plan.sheets.filter((sheet) => sheet.row === 0);
    const steps = row.slice(1).map((sheet, index) => sheet.view.x - (row[index]?.view.x ?? 0));
    for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? 0, 6);
  });
});

describe('printing onto a roll', () => {
  it('takes its width from the roll and lets the length follow', () => {
    const bounds = chart(6000, 1400);
    const plan = planPrint(bounds, { paper: 'A0', orientation: 'landscape', fit: 'roll' });
    // An A0 roll is 841 mm across whichever way the chooser is set -- a roll cannot be turned.
    expect(plan.page.h).toBe(841);
    expect(plan.mmPerUnit).toBeCloseTo((841 - 2 * MARGIN) / withPad(bounds).h, 10);
    expect(plan.page.w).toBeCloseTo(withPad(bounds).w * plan.mmPerUnit + 2 * MARGIN, 8);
    expect(plan.capped).toBe(false);
  });

  it('ignores the orientation, because a roll has only one width', () => {
    const bounds = chart(6000, 1400);
    const landscape = planPrint(bounds, { paper: 'A1', orientation: 'landscape', fit: 'roll' });
    const portrait = planPrint(bounds, { paper: 'A1', orientation: 'portrait', fit: 'roll' });
    expect(portrait.page).toEqual(landscape.page);
    expect(Math.min(PAPERS.A1.w, PAPERS.A1.h)).toBe(landscape.page.h);
  });

  it('shortens a roll that no reader could open, and says that it did', () => {
    /* A shallow chart on a wide roll wants an enormous enlargement, and the length that follows
       runs past what a PDF page may be. Reduced instead of produced broken. */
    const plan = planPrint(chart(90000, 300), {
      paper: 'A0',
      orientation: 'landscape',
      fit: 'roll',
    });
    expect(plan.capped).toBe(true);
    expect(plan.page.w).toBeLessThanOrEqual(MAX_PAGE_MM);
  });
});

describe('suggesting a paper', () => {
  it('picks the smallest sheet the names survive on', () => {
    const bounds = chart(1200, 600);
    const suggestion = suggest(bounds);
    expect(planPrint(bounds, suggestion).typeMm).toBeGreaterThanOrEqual(MIN_TYPE_MM);
    // And one step down would not have been readable, which is what "smallest" has to mean.
    expect(planPrint(bounds, { ...suggestion, paper: 'A4' }).typeMm >= MIN_TYPE_MM).toBe(
      suggestion.paper === 'A4',
    );
  });

  it('grows with the chart, all the way up the series', () => {
    const papers = [
      suggest(chart(600, 400)),
      suggest(chart(3000, 1200)),
      suggest(chart(9000, 2400)),
    ].map((choice) => choice.paper);
    // Never smaller for a bigger chart. Equality is allowed: two sizes can share a sheet.
    const order = ['A4', 'A3', 'A2', 'A1', 'A0'];
    expect(order.indexOf(papers[1] ?? '')).toBeGreaterThanOrEqual(
      order.indexOf(papers[0] ?? ''),
    );
    expect(order.indexOf(papers[2] ?? '')).toBeGreaterThanOrEqual(
      order.indexOf(papers[1] ?? ''),
    );
  });

  it('turns a wide chart sideways, because that is the way round it wastes less paper', () => {
    expect(suggest(chart(4000, 800)).orientation).toBe('landscape');
  });

  it('sends a chart past A0 to a roll rather than to an unreadable sheet', () => {
    const suggestion = suggest(chart(120000, 6000));
    expect(suggestion.fit).toBe('roll');
    expect(suggestion.paper).toBe('A0');
  });

  it('answers for an empty chart instead of dividing by nothing', () => {
    const nothing: Bounds = { minX: 0, minY: 0, width: 0, height: 0 };
    expect(isEmpty(nothing)).toBe(true);
    expect(suggest(nothing)).toEqual({ paper: 'A4', orientation: 'landscape', fit: 'sheet' });
  });

  it('counts a chart with something in it as printable', () => {
    expect(isEmpty(chart(10, 10))).toBe(false);
  });
});

describe('writing the numbers down', () => {
  it('rounds a page to the millimetre and keeps a decimal on small type', () => {
    expect(mm(841.2)).toBe('841');
    expect(mm(2.34)).toBe('2.3');
  });

  it('gives a wall in metres', () => {
    expect(metres(2345)).toBe('2.35');
  });
});
