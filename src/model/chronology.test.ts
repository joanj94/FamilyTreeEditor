/**
 * Reducing a date to something sortable.
 *
 * The properties under test are the four rules the module's header states, because each of them is
 * a decision that would be silently wrong rather than loudly broken if it regressed:
 *
 * 1. A calendar this cannot convert is reported as unknown, never sorted by numbers that mean
 *    something else.
 * 2. Missing precision sorts first within its year and is never written back as a date.
 * 3. Unknown sorts last and, under a stable sort, keeps the order the document had.
 * 4. `BIRT` always beats the events that only stand in for it.
 *
 * The last block runs real payloads through the actual parser. `timeOf` reads `GenDate.start`, and
 * a test built only from hand-written literals would keep passing if the parser stopped producing
 * the shape it reads -- which is the regression that would matter and the one literals cannot see.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { parseDateValue } from '../gedcom/dates.js';
import {
  birthIndex,
  birthOf,
  compareTimes,
  olderFirst,
  timeOf,
  type TimeKey,
} from './chronology.js';
import type { GedcomDoc, GenDate, Individual, IndividualEventTag } from './types.js';

/** A `GenDate` carrying one parsed point, which is what an `EXACT` date looks like. */
const on = (year: number, month?: number, day?: number, extra = {}): GenDate => ({
  value: 'placeholder',
  kind: 'EXACT',
  start: {
    calendar: 'GREGORIAN',
    year,
    ...(month === undefined ? {} : { month }),
    ...(day === undefined ? {} : { day }),
    ...extra,
  },
});

const person = (
  xref: string,
  events: readonly { readonly tag: IndividualEventTag; readonly date?: GenDate }[] = [],
): Individual => ({ xref, events });

const docOf = (individuals: readonly Individual[]): GedcomDoc => ({
  header: { gedcomVersion: '7.0' },
  individuals,
  families: [],
});

describe('timeOf', () => {
  it('reads year, month and day where the date states them', () => {
    expect(timeOf(on(1901, 2, 3))).toEqual({ year: 1901, month: 2, day: 3 });
  });

  it('leaves unstated parts at zero rather than filling them in', () => {
    // The whole reason CalendarDate is shaped as it is: ABT 1901 must not become 1901-01-01.
    expect(timeOf(on(1901))).toEqual({ year: 1901, month: 0, day: 0 });
    expect(timeOf(on(1901, 6))).toEqual({ year: 1901, month: 6, day: 0 });
  });

  it('negates a BCE year so the ordering runs through zero', () => {
    expect(timeOf(on(44, 3, 15, { epoch: 'BCE' }))?.year).toBe(-44);
    expect(compareTimes(timeOf(on(44, 3, 15, { epoch: 'BCE' })), timeOf(on(1)))).toBeLessThan(
      0,
    );
  });

  it('treats a calendar it cannot convert as unknown', () => {
    // 5661 in the Hebrew calendar is not 5661 in the Gregorian one, and sorting it as though it
    // were would put the person four thousand years from where they belong.
    for (const calendar of ['HEBREW', 'FRENCH_R', '_SOMEBODYS_EXTENSION']) {
      expect(timeOf(on(5661, 1, 1, { calendar }))).toBeUndefined();
    }
  });

  it('reads Julian dates, which are close enough to order by', () => {
    expect(timeOf(on(1701, 2, 3, { calendar: 'JULIAN' }))).toEqual({
      year: 1701,
      month: 2,
      day: 3,
    });
  });

  it('has no opinion about a date it could not parse', () => {
    expect(timeOf({ value: 'sometime in the war', kind: 'UNPARSED' })).toBeUndefined();
    expect(timeOf(undefined)).toBeUndefined();
  });

  it('falls back to the far end of a range whose near end is unreadable', () => {
    expect(
      timeOf({
        value: 'placeholder',
        kind: 'RANGE',
        modifier: 'BET',
        start: { calendar: 'HEBREW', year: 5661 },
        end: { calendar: 'GREGORIAN', year: 1901 },
      }),
    ).toEqual({ year: 1901, month: 0, day: 0 });
  });
});

describe('compareTimes', () => {
  it('puts the earlier date first', () => {
    expect(compareTimes(timeOf(on(1900)), timeOf(on(1901)))).toBeLessThan(0);
    expect(compareTimes(timeOf(on(1901, 2)), timeOf(on(1901, 3)))).toBeLessThan(0);
    expect(compareTimes(timeOf(on(1901, 2, 3)), timeOf(on(1901, 2, 4)))).toBeLessThan(0);
  });

  it('puts a year-only date ahead of a dated one in the same year', () => {
    expect(compareTimes(timeOf(on(1901)), timeOf(on(1901, 1, 1)))).toBeLessThan(0);
  });

  it('puts unknown last, and calls two unknowns equal', () => {
    expect(compareTimes(undefined, timeOf(on(1901)))).toBeGreaterThan(0);
    expect(compareTimes(timeOf(on(1901)), undefined)).toBeLessThan(0);
    expect(compareTimes(undefined, undefined)).toBe(0);
  });

  it('is a total order: antisymmetric, and transitive across the unknowns', () => {
    const key = fc.option(
      fc.record({
        year: fc.integer({ min: -3000, max: 3000 }),
        month: fc.integer({ min: 0, max: 13 }),
        day: fc.integer({ min: 0, max: 31 }),
      }),
      { nil: undefined },
    ) as fc.Arbitrary<TimeKey | undefined>;

    fc.assert(
      fc.property(key, key, (left, right) => {
        // Summed rather than negated: Math.sign(0) is -0, and Object.is distinguishes it from 0.
        const forward = Math.sign(compareTimes(left, right));
        const backward = Math.sign(compareTimes(right, left));
        expect(forward + backward).toBe(0);
        expect(Math.abs(forward)).toBe(Math.abs(backward));
      }),
    );
    fc.assert(
      fc.property(key, key, key, (a, b, c) => {
        if (compareTimes(a, b) <= 0 && compareTimes(b, c) <= 0) {
          expect(compareTimes(a, c)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it('leaves an undated document in the order it arrived', () => {
    // The guarantee that makes the whole feature safe to offer: a file with no dates in it comes
    // back exactly as it went in, rather than reshuffled by identifier.
    const undated = ['@I3@', '@I1@', '@I2@'];
    const born = birthIndex(docOf(undated.map((xref) => person(xref))));
    expect([...undated].sort(olderFirst(born))).toEqual(undated);
  });
});

describe('birthOf', () => {
  it('reads the birth', () => {
    expect(birthOf(person('@I1@', [{ tag: 'BIRT', date: on(1901) }]))?.year).toBe(1901);
  });

  it('accepts a christening or a baptism where there is no birth', () => {
    // Parish registers routinely record only the baptism. Dropping those people to the bottom of
    // every sibling list would make this useless on exactly the files that need it.
    expect(birthOf(person('@I1@', [{ tag: 'CHR', date: on(1901) }]))?.year).toBe(1901);
    expect(birthOf(person('@I1@', [{ tag: 'BAPM', date: on(1901) }]))?.year).toBe(1901);
  });

  it('prefers the birth to the substitutes, whatever order the record lists them in', () => {
    const individual = person('@I1@', [
      { tag: 'CHR', date: on(1902) },
      { tag: 'BIRT', date: on(1901) },
    ]);
    expect(birthOf(individual)?.year).toBe(1901);
  });

  it('looks past a birth it cannot read to one it can', () => {
    const individual = person('@I1@', [
      { tag: 'BIRT', date: { value: 'during the war', kind: 'UNPARSED' } },
      { tag: 'BIRT', date: on(1901) },
    ]);
    expect(birthOf(individual)?.year).toBe(1901);
  });

  it('reports no birth rather than a wrong one', () => {
    expect(birthOf(person('@I1@'))).toBeUndefined();
    expect(birthOf(person('@I1@', [{ tag: 'DEAT', date: on(1901) }]))).toBeUndefined();
  });
});

describe('birthIndex', () => {
  it('holds only the people who have a usable date', () => {
    const doc = docOf([
      person('@I1@', [{ tag: 'BIRT', date: on(1901) }]),
      person('@I2@'),
      person('@I3@', [{ tag: 'BIRT', date: { value: 'unknown', kind: 'UNPARSED' } }]),
    ]);
    expect([...birthIndex(doc).keys()]).toEqual(['@I1@']);
  });
});

describe('against the real parser', () => {
  // timeOf reads GenDate.start. These pin that field to what parse actually produces, so the
  // module cannot keep passing its own literals after the parser changes shape underneath it.
  const cases: readonly (readonly [string, TimeKey | undefined])[] = [
    ['3 FEB 1901', { year: 1901, month: 2, day: 3 }],
    ['FEB 1901', { year: 1901, month: 2, day: 0 }],
    ['1901', { year: 1901, month: 0, day: 0 }],
    ['ABT 1901', { year: 1901, month: 0, day: 0 }],
    ['EST 1901', { year: 1901, month: 0, day: 0 }],
    ['BEF 1901', { year: 1901, month: 0, day: 0 }],
    ['BET 1901 AND 1905', { year: 1901, month: 0, day: 0 }],
    ['FROM 1901 TO 1905', { year: 1901, month: 0, day: 0 }],
    ['@#DJULIAN@ 3 FEB 1701', { year: 1701, month: 2, day: 3 }],
    ['@#DHEBREW@ 5661', undefined],
    ['sometime after the war', undefined],
  ];

  for (const [payload, expected] of cases) {
    it(`reads ${payload}`, () => {
      expect(timeOf(parseDateValue(payload))).toEqual(expected);
    });
  }

  it('orders a set of real payloads the way a reader would', () => {
    const payloads = ['1905', 'ABT 1901', '3 FEB 1901', 'JAN 1901', 'not a date'];
    const sorted = [...payloads].sort((left, right) =>
      compareTimes(timeOf(parseDateValue(left)), timeOf(parseDateValue(right))),
    );
    expect(sorted).toEqual(['ABT 1901', 'JAN 1901', '3 FEB 1901', '1905', 'not a date']);
  });
});
