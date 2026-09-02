/**
 * Putting the document in chronological order.
 *
 * Three properties carry the whole feature, and each of them is a way this could go wrong quietly:
 *
 * **Nothing is lost.** Every list that comes out is a permutation of the one that went in. A sort
 * that dropped a child would produce a chart that still draws, still exports, and is missing a
 * person -- the worst failure this repository can ship, and the reason it is checked as a property
 * over generated documents rather than on one fixture.
 *
 * **Nothing is broken.** `audit()` passes on the way in and must pass on the way out. Order is
 * meaningless to GEDCOM, so a reordering that breaks referential integrity has done something it
 * was never asked to do.
 *
 * **Nothing moves that has no reason to.** Undated people keep their place, and a document already
 * in order comes back as the very same object. A user who presses the button twice must not get a
 * different chart the second time.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { audit, auditErrors } from './audit.js';
import { sortByBirth } from './sort.js';
import type { Family, GedcomDoc, GenDate, Individual } from './types.js';

const on = (year: number, month?: number, day?: number): GenDate => ({
  value: String(year),
  kind: 'EXACT',
  start: {
    calendar: 'GREGORIAN',
    year,
    ...(month === undefined ? {} : { month }),
    ...(day === undefined ? {} : { day }),
  },
});

/** A person, born in the given year where one is given. */
const born = (xref: string, year?: number): Individual => ({
  xref,
  ...(year === undefined ? {} : { events: [{ tag: 'BIRT' as const, date: on(year) }] }),
});

/**
 * A family and its children, with both halves of every link written down.
 *
 * Built symmetrically on purpose: the point of the audit check below is that a *valid* document
 * stays valid, and one that arrived broken would prove nothing.
 */
function tree(
  children: readonly Individual[],
  options: { readonly married?: number } = {},
): GedcomDoc {
  const family: Family = {
    xref: '@F1@',
    husband: '@I90@',
    wife: '@I91@',
    children: children.map((child) => child.xref),
    ...(options.married === undefined
      ? {}
      : { events: [{ tag: 'MARR' as const, date: on(options.married) }] }),
  };
  return {
    header: { gedcomVersion: '7.0' },
    individuals: [
      { ...born('@I90@', 1860), familiesAsSpouse: [{ xref: '@F1@' }] },
      { ...born('@I91@', 1865), familiesAsSpouse: [{ xref: '@F1@' }] },
      ...children.map((child) => ({ ...child, familiesAsChild: [{ xref: '@F1@' }] })),
    ],
    families: [family],
  };
}

const childrenOf = (doc: GedcomDoc): readonly string[] => doc.families[0]?.children ?? [];

describe('sortByBirth', () => {
  it('puts siblings in the order they were born', () => {
    const doc = tree([born('@I3@', 1895), born('@I1@', 1890), born('@I2@', 1892)]);
    expect(childrenOf(sortByBirth(doc).doc)).toEqual(['@I1@', '@I2@', '@I3@']);
  });

  it('sorts within a year where the record is that precise', () => {
    const doc: GedcomDoc = tree([
      { xref: '@I2@', events: [{ tag: 'BIRT', date: on(1890, 11, 2) }] },
      { xref: '@I1@', events: [{ tag: 'BIRT', date: on(1890, 3, 4) }] },
    ]);
    expect(childrenOf(sortByBirth(doc).doc)).toEqual(['@I1@', '@I2@']);
  });

  it('leaves undated children after the dated ones, in the order the file had them', () => {
    // Not a detail: a half-dated family is the ordinary case, and a sort that scattered the
    // undated among the dated would read as a claim about when they were born.
    const doc = tree([born('@I9@'), born('@I3@', 1895), born('@I8@'), born('@I1@', 1890)]);
    expect(childrenOf(sortByBirth(doc).doc)).toEqual(['@I1@', '@I3@', '@I9@', '@I8@']);
  });

  it('sorts the people and the families as well as the children', () => {
    const doc = tree([born('@I3@', 1895), born('@I1@', 1890)]);
    const sorted = sortByBirth(doc).doc;
    // The layout walks doc.individuals, so the record order is as real as the CHIL order.
    expect(sorted.individuals.map((individual) => individual.xref)).toEqual([
      '@I90@',
      '@I91@',
      '@I1@',
      '@I3@',
    ]);
  });

  it('draws a remarriage after the marriage it followed', () => {
    // A person's unions are drawn in the order doc.families lists them, so a second marriage
    // entered into the file first would otherwise be drawn as though it came first.
    const doc: GedcomDoc = {
      header: { gedcomVersion: '7.0' },
      individuals: [{ xref: '@I1@', familiesAsSpouse: [{ xref: '@F2@' }, { xref: '@F1@' }] }],
      families: [
        { xref: '@F2@', husband: '@I1@', events: [{ tag: 'MARR', date: on(1920) }] },
        { xref: '@F1@', husband: '@I1@', events: [{ tag: 'MARR', date: on(1900) }] },
      ],
    };
    expect(sortByBirth(doc).doc.families.map((family) => family.xref)).toEqual([
      '@F1@',
      '@F2@',
    ]);
  });

  it('dates an undated union by its earliest child', () => {
    const doc: GedcomDoc = {
      header: { gedcomVersion: '7.0' },
      individuals: [born('@I1@', 1890), born('@I2@', 1880)],
      families: [
        { xref: '@F2@', children: ['@I1@'] },
        { xref: '@F1@', children: ['@I2@'] },
      ],
    };
    expect(sortByBirth(doc).doc.families.map((family) => family.xref)).toEqual([
      '@F1@',
      '@F2@',
    ]);
  });

  it('counts no family where only the marriages moved', () => {
    /* The case the repository's own fixture turned out to be: every CHIL list already tidy, the
       FAM records out of order. The document really did change, so a report leading with a count
       of families would say nothing happened. */
    const doc: GedcomDoc = {
      header: { gedcomVersion: '7.0' },
      individuals: [{ xref: '@I1@', familiesAsSpouse: [{ xref: '@F2@' }, { xref: '@F1@' }] }],
      families: [
        { xref: '@F2@', husband: '@I1@', events: [{ tag: 'MARR', date: on(1920) }] },
        { xref: '@F1@', husband: '@I1@', events: [{ tag: 'MARR', date: on(1900) }] },
      ],
    };
    const report = sortByBirth(doc);
    expect(report.changed).toBe(true);
    expect(report.familiesReordered).toBe(0);
  });

  it('reports what it did', () => {
    const doc = tree([born('@I3@', 1895), born('@I1@', 1890), born('@I8@')]);
    const report = sortByBirth(doc);
    expect(report.familiesReordered).toBe(1);
    expect(report.undated).toBe(1);
    expect(report.changed).toBe(true);
  });

  it('reports no change, and hands the same document back, where there is nothing to do', () => {
    // Not merely an optimisation: the caller records a step in the undo stack for every change,
    // and a button that fills that stack with edits nobody made is a broken button.
    const doc = tree([born('@I1@', 1890), born('@I3@', 1895)]);
    const report = sortByBirth(doc);
    expect(report.changed).toBe(false);
    expect(report.doc).toBe(doc);
  });

  it('changes nothing at all in a document with no dates in it', () => {
    const doc = tree([born('@I3@'), born('@I1@'), born('@I2@')]);
    const report = sortByBirth(doc);
    expect(report.changed).toBe(false);
    expect(childrenOf(report.doc)).toEqual(['@I3@', '@I1@', '@I2@']);
  });

  it('is idempotent', () => {
    const doc = tree([
      born('@I3@', 1895),
      born('@I1@', 1890),
      born('@I8@'),
      born('@I2@', 1892),
    ]);
    const once = sortByBirth(doc).doc;
    const twice = sortByBirth(once);
    expect(twice.changed).toBe(false);
    expect(twice.doc).toBe(once);
  });

  it('carries everything it does not sort across untouched', () => {
    // The document holds records this editor has no opinion about, and a sort is not a licence to
    // start having one.
    const doc: GedcomDoc = {
      ...tree([born('@I1@', 1890)]),
      otherRecords: [{ xref: '@S1@', tag: 'SOUR' }],
      origin: { dialect: '5.5.1', encoding: 'ANSEL', fileName: 'placeholder.ged' },
    };
    const sorted = sortByBirth(doc).doc;
    expect(sorted.otherRecords).toBe(doc.otherRecords);
    expect(sorted.origin).toBe(doc.origin);
    expect(sorted.header).toBe(doc.header);
  });

  it('loses nobody, whatever the dates are', () => {
    const child = fc.record({
      xref: fc.integer({ min: 1, max: 40 }).map((n) => `@I${String(n)}@`),
      year: fc.option(fc.integer({ min: 1700, max: 2000 }), { nil: undefined }),
    });

    fc.assert(
      fc.property(fc.uniqueArray(child, { selector: (drawn) => drawn.xref }), (drawn) => {
        const doc = tree(drawn.map((one) => born(one.xref, one.year)));
        const sorted = sortByBirth(doc).doc;

        expect([...childrenOf(sorted)].sort()).toEqual([...childrenOf(doc)].sort());
        expect(sorted.individuals.map((one) => one.xref).sort()).toEqual(
          doc.individuals.map((one) => one.xref).sort(),
        );
      }),
    );
  });

  it('leaves a valid document valid', () => {
    const doc = tree([born('@I3@', 1895), born('@I1@', 1890), born('@I8@')]);
    expect(auditErrors(audit(doc))).toEqual([]);
    expect(auditErrors(audit(sortByBirth(doc).doc))).toEqual([]);
  });
});
