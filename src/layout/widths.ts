/**
 * How wide each person's box has to be.
 *
 * A box is sized to the name in it. The alternative -- one width for every box -- is what the
 * chart did until now, and it cut the long names off: `Maria del Carmen Fernández` drawn as
 * `Maria del Carmen F…` reads as a wrong record, and a reader who cannot see a surname cannot
 * tell two branches of a family apart.
 *
 * Widths are decided here, before the pack, because everything downstream is arithmetic on them:
 * a block is as wide as its members plus the gaps, a person's x is their slot in it, and a
 * connector joins the centre of a box. Measuring in the renderer instead would draw boxes the
 * layout had not made room for.
 *
 * **Short names still draw at `nodeW`.** The floor is what keeps the even column the chart has
 * always had; only a name that would not fit moves its own box, and nothing else on the row.
 */
import { GEOMETRY } from './geometry.js';
import { measureText } from './text.js';
import { displayName, displayYears } from '../model/labels.js';
import type { GedcomDoc, Individual, Xref } from '../model/types.js';

/** Person to the width of their box. A person the map does not name is drawn at `nodeW`. */
export type Widths = ReadonlyMap<Xref, number>;

/** The width of one box: its name, its years, the padding, and the floor and ceiling. */
export function personWidth(individual: Individual): number {
  const name = measureText(displayName(individual), GEOMETRY.nameSize);
  const years = measureText(displayYears(individual), GEOMETRY.yearsSize);
  const wanted = Math.max(name, years) + 2 * GEOMETRY.nodePadX;
  const fitted = Math.min(Math.max(wanted, GEOMETRY.nodeW), GEOMETRY.nodeMaxW);
  /* To an even number, so a centred box lands on a whole pixel and the connector meeting it is
     not drawn on a half. */
  return Math.ceil(fitted / 2) * 2;
}

/** Every box's width, measured once for the whole document. */
export function personWidths(doc: GedcomDoc): Widths {
  const widths = new Map<Xref, number>();
  for (const individual of doc.individuals)
    widths.set(individual.xref, personWidth(individual));
  return widths;
}

/** One person's width, falling back to the floor where nothing was measured. */
export function widthOf(widths: Widths, person: Xref): number {
  return widths.get(person) ?? GEOMETRY.nodeW;
}
