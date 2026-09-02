/**
 * When something happened, reduced to something two records can be sorted by.
 *
 * The model deliberately refuses to invent date parts: a year-only date has no month and no day,
 * and that absence is the whole reason `GenDate` is shaped as it is. Sorting, though, needs a
 * total order over things that were recorded to different precisions and in different calendars.
 * This module is where that reconciliation happens, and it is kept in one place so the rules are
 * stated once rather than re-decided at every call site.
 *
 * Four rules, and each of them is a refusal to guess:
 *
 * **A date this cannot compare is not compared.** Only Gregorian and Julian are read. The two
 * differ by at most thirteen days, which is never enough to reorder siblings; the Hebrew and
 * French Republican calendars would need real conversion, so a date in one of them is reported as
 * unknown rather than sorted by numbers that mean something else. Same for `UNPARSED`: the payload
 * survives, and this simply has no opinion about it.
 *
 * **Missing precision sorts first within its year, and is not a claim.** `1901` sorts before
 * `3 FEB 1901` because month zero precedes month one -- not because anybody decided the person was
 * born in January. Nothing here is ever written back to the document, so the convention costs the
 * record nothing.
 *
 * **Unknown goes last and keeps its place.** A person with no usable date must not be shuffled
 * into an arbitrary slot among people who have one. `compareTimes` puts them after everyone dated,
 * and because the sorts built on it are stable, they stay in the order the document already had
 * them -- so sorting a file with no dates in it changes nothing at all.
 *
 * **Christening stands in for birth, but only after birth.** Parish registers routinely record a
 * baptism and no birth, and dropping those people to the bottom of every sibling list would make
 * the feature useless on exactly the old files that need it most. `BIRT` is preferred wherever it
 * is present, so the substitution never overrides a real answer.
 */
import type {
  CalendarDate,
  GedcomDoc,
  GenDate,
  Individual,
  IndividualEventTag,
  Xref,
} from './types.js';

/**
 * A point in time, comparable by three numbers.
 *
 * `month` and `day` are zero where the source did not state them. Zero is not a month, which is
 * the point: it cannot be mistaken for one, and it sorts ahead of January without pretending to be
 * it.
 */
export interface TimeKey {
  /** Negative for `BCE`, so the ordering runs through zero the way a reader expects. */
  readonly year: number;
  /** 1-13, or 0 where unstated. */
  readonly month: number;
  /** 1-31, or 0 where unstated. */
  readonly day: number;
}

/** The events that may stand for a birth, best evidence first. */
const STANDS_FOR_BIRTH: readonly IndividualEventTag[] = ['BIRT', 'CHR', 'BAPM'];

/** The calendars whose numbers may be compared directly. See the header. */
const COMPARABLE = new Set(['GREGORIAN', 'JULIAN']);

/** The calendar a date is in when it does not say, per the specification. */
const DEFAULT_CALENDAR = 'GREGORIAN';

function keyOfPoint(point: CalendarDate | undefined): TimeKey | undefined {
  if (point?.year === undefined) return undefined;
  if (!COMPARABLE.has(point.calendar ?? DEFAULT_CALENDAR)) return undefined;
  return {
    year: point.epoch === 'BCE' ? -point.year : point.year,
    month: point.month ?? 0,
    day: point.day ?? 0,
  };
}

/**
 * Read a `DATE` as one point.
 *
 * A range or a period has two ends and this takes the first it can read. That is a simplification
 * and worth naming: `BEF 1850` is an upper bound, not a date in 1850, so sorting it as one places
 * it later than the person may actually belong. The alternative -- refusing to sort every bounded
 * date -- drops far more people to the bottom of the list than it saves, and the bound is still
 * the best single number the record offers.
 */
export function timeOf(date: GenDate | undefined): TimeKey | undefined {
  if (date === undefined) return undefined;
  return keyOfPoint(date.start) ?? keyOfPoint(date.end);
}

/**
 * When a person was born, as far as their record allows.
 *
 * Every event carrying the preferred tag is examined before falling back to the next one, so a
 * `BIRT` whose payload this cannot read does not shadow a second `BIRT` that it can.
 */
export function birthOf(individual: Individual): TimeKey | undefined {
  for (const tag of STANDS_FOR_BIRTH) {
    for (const event of individual.events ?? []) {
      if (event.tag !== tag) continue;
      const key = timeOf(event.date);
      if (key !== undefined) return key;
    }
  }
  return undefined;
}

/**
 * Earlier first, and unknown last.
 *
 * Returns zero for two equal dates and for two unknowns, which is what leaves a stable sort free
 * to keep the document's own order as the tie-break. That is deliberate rather than incidental:
 * falling back to the identifier would override the order the file was written in for two people
 * born on the same day, and the file's order is the better evidence.
 */
export function compareTimes(left: TimeKey | undefined, right: TimeKey | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return left.year - right.year || left.month - right.month || left.day - right.day;
}

/**
 * Every person's birth, indexed.
 *
 * Only the people who have a usable one appear, so `get` returning undefined is the single
 * representation of "not known", rather than a sentinel date somebody has to remember to check
 * for.
 */
export function birthIndex(doc: GedcomDoc): ReadonlyMap<Xref, TimeKey> {
  const born = new Map<Xref, TimeKey>();
  for (const individual of doc.individuals) {
    const key = birthOf(individual);
    if (key !== undefined) born.set(individual.xref, key);
  }
  return born;
}

/** Compare two people by birth, given an index. The comparator the sorts and the layout share. */
export function olderFirst(
  born: ReadonlyMap<Xref, TimeKey>,
): (left: Xref, right: Xref) => number {
  return (left, right) => compareTimes(born.get(left), born.get(right));
}
