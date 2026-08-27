/**
 * What the chart becomes on paper.
 *
 * A family tree is the wrong shape for a sheet of paper. It is wide, shallow and grows sideways
 * with every generation, so the interesting question is never "portrait or landscape" -- it is
 * *how big a piece of paper this drawing actually needs*, and that is arithmetic the reader
 * should not have to do. Everything here is that arithmetic, kept pure so it can be asserted
 * without a printer, a browser or a DOM.
 *
 * **Three ways of putting a drawing onto paper, because there are three real situations.**
 *
 * - `sheet` -- the whole chart, shrunk until it fits one page. What a home printer does, and what
 *   a reader wants for a small family.
 * - `tiles` -- the chart at its natural size, spread over a grid of ordinary sheets that are then
 *   taped together. The only option for somebody who has A4 and a wall.
 * - `roll` -- one continuous page as long as the chart needs, for a plotter or a copy shop. This
 *   is what large-format printing actually is: the paper comes off a roll of fixed width, and the
 *   length is whatever you ask for. A0 here means an 841 mm roll, not an A0 sheet.
 *
 * **Millimetres throughout, and one number connects them to the drawing.** `mmPerUnit` is how
 * much of the page one layout unit becomes. The rest of the module is that number computed three
 * different ways, and the page geometry that follows from it. CSS pixels are 1/96 in by
 * definition, so `MM_PER_UNIT` is the size the chart is on screen -- printing at exactly that is
 * 1:1, and every other value is an honest enlargement or reduction of it.
 *
 * **The suggestion is the point of the module.** `suggest` reads the chart's own extent and names
 * the smallest paper on which the names are still readable, because "which of A4, A3, A2, A1, A0
 * do I need" is precisely the question a reader cannot answer by looking at the screen.
 */
import { GEOMETRY } from '../layout/layout.js';
import type { Bounds } from './scene.js';

/** The ISO A series, smallest first. The order is the search order in `suggest`. */
export const PAPERS = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
} as const;

export type PaperName = keyof typeof PAPERS;

/** Smallest first, which is the order the chooser lists them in and the order `suggest` walks. */
export const PAPER_NAMES: readonly PaperName[] = ['A4', 'A3', 'A2', 'A1', 'A0'];

export type Orientation = 'portrait' | 'landscape';

/** How the drawing is put onto the paper. See the three cases in the module comment. */
export type Fit = 'sheet' | 'tiles' | 'roll';

export const FITS: readonly Fit[] = ['sheet', 'tiles', 'roll'];

/** A page, in millimetres. Also used for the finished size of an assembled drawing. */
export interface Page {
  readonly w: number;
  readonly h: number;
}

/** What the reader has chosen, or what `suggest` proposes they choose. */
export interface Choice {
  readonly paper: PaperName;
  readonly orientation: Orientation;
  readonly fit: Fit;
}

/**
 * One printed page, and the slice of the drawing on it.
 *
 * `view` is in layout units and is what becomes the page's `viewBox`: a single-sheet plan has one
 * of these covering the whole chart, and a tiled plan has one per sheet, each overlapping its
 * neighbours by `OVERLAP`.
 */
export interface Sheet {
  /** 1-based, because it is written on the sheet for somebody assembling them by hand. */
  readonly index: number;
  readonly row: number;
  readonly column: number;
  readonly view: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/** A chart, a paper, and everything that follows from putting one on the other. */
export interface Plan {
  readonly choice: Choice;
  /** The page to ask the printer for. `@page size` is set from exactly this. */
  readonly page: Page;
  /** The unprintable edge left clear, on every side of every page. */
  readonly margin: number;
  /** One layout unit, in millimetres. The single number that ties the drawing to the paper. */
  readonly mmPerUnit: number;
  readonly sheets: readonly Sheet[];
  readonly across: number;
  readonly down: number;
  /** What the assembled drawing measures once printed, ignoring the margins around it. */
  readonly finished: Page;
  /**
   * How tall a name is on paper.
   *
   * The one number that says whether a plan is worth printing. A chart reduced until it fits is
   * still a chart; a chart reduced until the names are 0.4 mm tall is a grey texture, and the
   * reader deserves to be told which one they are about to spend a copy shop's money on.
   */
  readonly typeMm: number;
  /** True where a roll was shortened to stay inside what a PDF page can be. See `MAX_PAGE_MM`. */
  readonly capped: boolean;
}

/**
 * One CSS pixel in millimetres.
 *
 * A CSS pixel is 1/96 in by definition, so this is exact rather than a calibration: a chart
 * printed at this many millimetres per layout unit is the size it is on screen at 100%.
 */
export const MM_PER_UNIT = 25.4 / 96;

/**
 * The edge left clear on every page.
 *
 * Not taste: consumer printers cannot put ink within roughly 5 mm of the paper's edge and silently
 * clip what is there, which on a tiled chart means a column of names quietly missing from the
 * seam. Ten is that floor with room to hold the sheet.
 */
export const MARGIN = 10;

/**
 * How much of the drawing neighbouring tiles share.
 *
 * Tiles are cut out and taped, and a cut is never exactly on the line. An overlap gives something
 * to cut *within* and something to glue, and it means a name landing on a seam is printed whole on
 * one of the two sheets rather than halved across both.
 */
export const OVERLAP = 10;

/** The air left around the drawing, in layout units, so nothing is printed hard against a trim. */
export const PAD = 24;

/**
 * How small a name may be printed and still be a name.
 *
 * Two millimetres of type is about 5.5 pt -- small, but a wall chart is read from a foot away and
 * this is roughly the size the smallest print on a passport is set at. Below it the chart stops
 * carrying information, which is what makes this the threshold `suggest` searches against rather
 * than merely a warning.
 */
export const MIN_TYPE_MM = 2;

/**
 * The longest page anything downstream will accept.
 *
 * PDF measures pages in 1/72 in and gives the number 14 400 units, which is 200 in -- a little
 * over five metres. A roll longer than that is not a print job, it is a file that will not open,
 * so a plan that would exceed it is reduced instead and says so.
 */
export const MAX_PAGE_MM = 5000;

/** The paper turned the way it is being used. */
export function pageOf(paper: PaperName, orientation: Orientation): Page {
  const { w, h } = PAPERS[paper];
  return orientation === 'portrait' ? { w, h } : { w: h, h: w };
}

/** What is left of a page once the margins are taken off it. */
function inkOf(page: Page, margin: number): Page {
  return { w: Math.max(1, page.w - 2 * margin), h: Math.max(1, page.h - 2 * margin) };
}

/** The chart's extent with the air around it, which is what is actually laid onto the paper. */
function padded(bounds: Bounds): Bounds {
  return {
    minX: bounds.minX - PAD,
    minY: bounds.minY - PAD,
    width: bounds.width + 2 * PAD,
    height: bounds.height + 2 * PAD,
  };
}

/** True where there is nothing to print -- an empty document, or a chart folded away to nothing. */
export function isEmpty(bounds: Bounds): boolean {
  return !(bounds.width > 0) || !(bounds.height > 0);
}

/**
 * How many tiles a run of drawing needs.
 *
 * The first tile covers `ink`; every one after it advances by `ink - overlap`, because the overlap
 * is drawn twice on purpose. Guarded against an overlap as wide as the page, which would otherwise
 * advance by nothing and tile forever.
 */
function tilesAcross(total: number, ink: number, overlap: number): number {
  if (total <= ink) return 1;
  const step = Math.max(ink - overlap, ink / 2);
  return 1 + Math.ceil((total - ink) / step);
}

/**
 * The grid of slices, numbered left to right and top to bottom -- reading order, for assembly.
 *
 * The step is derived from the count rather than the count from the step, so the overlap is shared
 * out evenly across the whole run. Advancing by a fixed step instead leaves the last column
 * overlapping its neighbour by whatever happens to be left over, which is usually almost the whole
 * sheet: a final tile that is 90% a repeat of the one before it.
 */
function sliceInto(
  area: Bounds,
  ink: Page,
  mmPerUnit: number,
  overlap: number,
): { readonly sheets: readonly Sheet[]; readonly across: number; readonly down: number } {
  const unitsW = ink.w / mmPerUnit;
  const unitsH = ink.h / mmPerUnit;
  const across = tilesAcross(area.width, unitsW, overlap / mmPerUnit);
  const down = tilesAcross(area.height, unitsH, overlap / mmPerUnit);
  const stepX = across === 1 ? 0 : (area.width - unitsW) / (across - 1);
  const stepY = down === 1 ? 0 : (area.height - unitsH) / (down - 1);

  const sheets: Sheet[] = [];
  for (let row = 0; row < down; row += 1) {
    for (let column = 0; column < across; column += 1) {
      sheets.push({
        index: row * across + column + 1,
        row,
        column,
        view: {
          x: area.minX + column * stepX,
          y: area.minY + row * stepY,
          w: unitsW,
          h: unitsH,
        },
      });
    }
  }
  return { sheets, across, down };
}

/** One sheet showing the whole drawing, centred in the ink area. */
function wholeOf(area: Bounds, ink: Page, mmPerUnit: number): Sheet {
  const unitsW = ink.w / mmPerUnit;
  const unitsH = ink.h / mmPerUnit;
  return {
    index: 1,
    row: 0,
    column: 0,
    view: {
      /* Centred: what is left over after fitting is shared between the two sides, not all put on
         the right, which would print a chart hard against one trim and floating off the other. */
      x: area.minX - (unitsW - area.width) / 2,
      y: area.minY - (unitsH - area.height) / 2,
      w: unitsW,
      h: unitsH,
    },
  };
}

/**
 * Turn a chart and a choice into everything needed to print it.
 *
 * The three cases differ only in where `mmPerUnit` comes from:
 *
 * - `sheet` takes it from the page -- whatever makes the drawing fit, enlarging as readily as
 *   reducing. Fit means fit: a two-person tree asked onto A0 really is drawn 800 mm wide, and a
 *   reader who did not want that wanted a smaller paper.
 * - `tiles` fixes it at 1:1. Tiling exists to print a chart *at its proper size* when no single
 *   sheet is big enough, so the paper choice changes how many sheets it takes and nothing else,
 *   which is the only rule that makes the sheet count mean anything.
 * - `roll` takes it from the roll's width, which is fixed, and lets the length follow.
 */
export function planPrint(bounds: Bounds, choice: Choice, margin: number = MARGIN): Plan {
  const area = padded(bounds);

  if (choice.fit === 'roll') {
    /* A roll has one fixed dimension -- its width -- and that is the paper's short side however
       the chooser is set, because you cannot turn a roll sideways. The chart's height goes across
       the roll and its width runs along it, which is the way round a family tree wants: trees are
       wide and shallow, and the roll is the axis with no limit on it. */
    const rollWidth = Math.min(PAPERS[choice.paper].w, PAPERS[choice.paper].h);
    const wanted = Math.max(1, rollWidth - 2 * margin) / area.height;
    const longest = (MAX_PAGE_MM - 2 * margin) / area.width;
    const capped = wanted > longest;
    const mmPerUnit = capped ? longest : wanted;
    const page = { w: area.width * mmPerUnit + 2 * margin, h: rollWidth };
    return {
      choice,
      page,
      margin,
      mmPerUnit,
      sheets: [wholeOf(area, inkOf(page, margin), mmPerUnit)],
      across: 1,
      down: 1,
      finished: { w: area.width * mmPerUnit, h: area.height * mmPerUnit },
      typeMm: GEOMETRY.nameSize * mmPerUnit,
      capped,
    };
  }

  const page = pageOf(choice.paper, choice.orientation);
  const ink = inkOf(page, margin);

  if (choice.fit === 'tiles') {
    const grid = sliceInto(area, ink, MM_PER_UNIT, OVERLAP);
    return {
      choice,
      page,
      margin,
      mmPerUnit: MM_PER_UNIT,
      ...grid,
      finished: { w: area.width * MM_PER_UNIT, h: area.height * MM_PER_UNIT },
      typeMm: GEOMETRY.nameSize * MM_PER_UNIT,
      capped: false,
    };
  }

  const mmPerUnit = Math.min(ink.w / area.width, ink.h / area.height);
  return {
    choice,
    page,
    margin,
    mmPerUnit,
    sheets: [wholeOf(area, ink, mmPerUnit)],
    across: 1,
    down: 1,
    finished: { w: area.width * mmPerUnit, h: area.height * mmPerUnit },
    typeMm: GEOMETRY.nameSize * mmPerUnit,
    capped: false,
  };
}

/**
 * The paper this chart wants.
 *
 * The smallest sheet on which the whole drawing fits with its names still readable, taking the
 * orientation that fits it better. Smallest rather than largest because a chart that fits on A3
 * should not send somebody to a copy shop, and readable rather than merely fitting because
 * everything fits on A4 if you are willing to reduce it to a smudge.
 *
 * A chart that will not fit legibly even on A0 gets a roll, which is the honest answer: past that
 * size there is no sheet, only a plotter, and the length is exactly what a roll has to give.
 */
export function suggest(bounds: Bounds): Choice {
  if (isEmpty(bounds)) return { paper: 'A4', orientation: 'landscape', fit: 'sheet' };

  const orientations: readonly Orientation[] = ['landscape', 'portrait'];
  for (const paper of PAPER_NAMES) {
    const best = orientations
      .map((orientation) => ({
        orientation,
        plan: planPrint(bounds, { paper, orientation, fit: 'sheet' }),
      }))
      /* Better fit first, so a chart that is readable either way is offered the way round that
         wastes less paper -- which for a family tree is nearly always landscape. */
      .sort((first, second) => second.plan.typeMm - first.plan.typeMm)[0];
    if (best !== undefined && best.plan.typeMm >= MIN_TYPE_MM) {
      return { paper, orientation: best.orientation, fit: 'sheet' };
    }
  }

  return { paper: 'A0', orientation: 'landscape', fit: 'roll' };
}

/** Millimetres as a person writes them: whole numbers on a page, one decimal on small type. */
export function mm(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

/** Millimetres as metres, for a finished size that has stopped being a page and become a wall. */
export function metres(value: number): string {
  return (value / 1000).toFixed(2);
}
