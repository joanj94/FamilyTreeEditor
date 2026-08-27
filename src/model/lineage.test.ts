/**
 * The line through one person.
 *
 * The two things worth pinning down are the ones the walk deliberately does *not* do: it does not
 * climb into an ancestor's other marriages, and it does not walk on through the partner a
 * descendant married. Both are the difference between a line and half the chart.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { indexDoc } from './graph.js';
import { lineageOf } from './lineage.js';
import type { Family, GedcomDoc, Individual } from './types.js';

const doc = (individuals: Individual[], families: Family[]): GedcomDoc => ({
  header: { gedcomVersion: '7.0' },
  individuals,
  families,
});

const lineage = (document_: GedcomDoc, person: string) =>
  lineageOf(indexDoc(document_), person);

const people = (document_: GedcomDoc, person: string): string[] =>
  [...lineage(document_, person).people].sort();

/**
 * Grandparents @I1@ and @I2@; their children @I3@ and @I9@; @I3@ marries @I4@ and they have
 * @I5@; @I5@ marries @I6@ and they have @I7@.
 */
const fourGenerations = doc(
  [
    { xref: '@I1@', familiesAsSpouse: [{ xref: '@F1@' }] },
    { xref: '@I2@', familiesAsSpouse: [{ xref: '@F1@' }] },
    {
      xref: '@I3@',
      familiesAsChild: [{ xref: '@F1@' }],
      familiesAsSpouse: [{ xref: '@F2@' }],
    },
    { xref: '@I4@', familiesAsSpouse: [{ xref: '@F2@' }] },
    {
      xref: '@I5@',
      familiesAsChild: [{ xref: '@F2@' }],
      familiesAsSpouse: [{ xref: '@F3@' }],
    },
    { xref: '@I6@', familiesAsSpouse: [{ xref: '@F3@' }] },
    { xref: '@I7@', familiesAsChild: [{ xref: '@F3@' }] },
    { xref: '@I9@', familiesAsChild: [{ xref: '@F1@' }] },
  ],
  [
    { xref: '@F1@', husband: '@I1@', wife: '@I2@', children: ['@I3@', '@I9@'] },
    { xref: '@F2@', husband: '@I3@', wife: '@I4@', children: ['@I5@'] },
    { xref: '@F3@', husband: '@I5@', wife: '@I6@', children: ['@I7@'] },
  ],
);

describe('lineageOf', () => {
  it('takes everyone above and everyone below, however deep', () => {
    // @I5@: up through @I3@ to @I1@ and @I2@, down through @I7@. @I4@ and @I6@ come with them.
    expect(people(fourGenerations, '@I5@')).toEqual([
      '@I1@',
      '@I2@',
      '@I3@',
      '@I4@',
      '@I5@',
      '@I6@',
      '@I7@',
    ]);
  });

  it('leaves a sibling out: they are neither an ancestor nor a descendant', () => {
    expect(people(fourGenerations, '@I5@')).not.toContain('@I9@');
  });

  it('names every union the line runs through, so the dots and runs can be drawn with it', () => {
    expect([...lineage(fourGenerations, '@I5@').families].sort()).toEqual([
      '@F1@',
      '@F2@',
      '@F3@',
    ]);
  });

  it('includes the person themselves, even where they are joined to nobody', () => {
    const alone = doc([{ xref: '@I1@' }], []);
    expect(people(alone, '@I1@')).toEqual(['@I1@']);
    expect([...lineage(alone, '@I1@').families]).toEqual([]);
  });

  it('answers an identifier the document has not got with nobody, rather than throwing', () => {
    // The selection outlives the record it names for as long as it takes a delete to re-render.
    expect(people(fourGenerations, '@I404@')).toEqual([]);
  });

  it('takes the partner a descendant married, but not that partner’s own family', () => {
    /* @I6@ married in and is plainly one of the linked; her parents are somebody else's line.
       A walk that went on through her would drag a whole second family onto the chart. */
    const marriedIn = doc(
      [
        { xref: '@I1@', familiesAsSpouse: [{ xref: '@F1@' }] },
        { xref: '@I2@', familiesAsChild: [{ xref: '@F1@' }] },
        {
          xref: '@I6@',
          familiesAsSpouse: [{ xref: '@F2@' }],
          familiesAsChild: [{ xref: '@F9@' }],
        },
        { xref: '@I90@', familiesAsSpouse: [{ xref: '@F9@' }] },
      ],
      [
        { xref: '@F1@', husband: '@I1@', children: ['@I2@'] },
        { xref: '@F2@', husband: '@I2@', wife: '@I6@' },
        { xref: '@F9@', husband: '@I90@', children: ['@I6@'] },
      ],
    );
    expect(people(marriedIn, '@I1@')).toEqual(['@I1@', '@I2@', '@I6@']);
  });

  it('leaves an ancestor’s other marriage out of the line', () => {
    /* A great-grandfather's second wife is not an ancestor, and neither is her side of the
       family. The upward walk follows parent families only, which is what keeps it out. */
    const remarried = doc(
      [
        { xref: '@I1@', familiesAsSpouse: [{ xref: '@F1@' }, { xref: '@F2@' }] },
        { xref: '@I2@', familiesAsSpouse: [{ xref: '@F1@' }] },
        { xref: '@I3@', familiesAsChild: [{ xref: '@F1@' }] },
        { xref: '@I4@', familiesAsSpouse: [{ xref: '@F2@' }] },
        { xref: '@I5@', familiesAsChild: [{ xref: '@F2@' }] },
      ],
      [
        { xref: '@F1@', husband: '@I1@', wife: '@I2@', children: ['@I3@'] },
        { xref: '@F2@', husband: '@I1@', wife: '@I4@', children: ['@I5@'] },
      ],
    );
    expect(people(remarried, '@I3@')).toEqual(['@I1@', '@I2@', '@I3@']);
  });

  it('reads a link recorded on one side only, from either side', () => {
    /* GEDCOM records parentage twice and a file can arrive with half of it. `audit()` reports the
       asymmetry; the line still has to be drawn through it. */
    const childSideOnly = doc(
      [{ xref: '@I1@' }, { xref: '@I2@', familiesAsChild: [{ xref: '@F1@' }] }],
      [{ xref: '@F1@', husband: '@I1@' }],
    );
    expect(people(childSideOnly, '@I1@')).toEqual(['@I1@', '@I2@']);
    expect(people(childSideOnly, '@I2@')).toEqual(['@I1@', '@I2@']);

    const familySideOnly = doc(
      [{ xref: '@I1@' }, { xref: '@I2@' }],
      [{ xref: '@F1@', husband: '@I1@', children: ['@I2@'] }],
    );
    expect(people(familySideOnly, '@I1@')).toEqual(['@I1@', '@I2@']);
    expect(people(familySideOnly, '@I2@')).toEqual(['@I1@', '@I2@']);
  });

  it('returns on a document that already contains a descent cycle', () => {
    /* An imported file may well contain one -- `audit()` reports it -- and nothing here may hang
       while the user is reading that report. */
    const circular = doc(
      [
        {
          xref: '@I1@',
          familiesAsChild: [{ xref: '@F2@' }],
          familiesAsSpouse: [{ xref: '@F1@' }],
        },
        {
          xref: '@I2@',
          familiesAsChild: [{ xref: '@F1@' }],
          familiesAsSpouse: [{ xref: '@F2@' }],
        },
      ],
      [
        { xref: '@F1@', husband: '@I1@', children: ['@I2@'] },
        { xref: '@F2@', husband: '@I2@', children: ['@I1@'] },
      ],
    );
    expect(people(circular, '@I1@')).toEqual(['@I1@', '@I2@']);
  });

  it('ignores a pointer that names no record, and @VOID@ with it', () => {
    const ragged = doc(
      [{ xref: '@I1@', familiesAsSpouse: [{ xref: '@F9@' }] }],
      [{ xref: '@F1@', husband: '@I1@', wife: '@VOID@', children: ['@I404@'] }],
    );
    const found = lineage(ragged, '@I1@');
    expect([...found.people]).toEqual(['@I1@']);
    expect([...found.families]).toEqual(['@F1@']);
  });
});
