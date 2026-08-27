/**
 * Finding a person by name.
 *
 * The interesting cases are the forgiving ones: an accent the reader did not type, a middle name
 * they have forgotten, and two people with the same name who have to be told apart in the list.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { findByName, fold } from './find.js';
import type { GedcomDoc, Individual } from './types.js';

const doc = (individuals: Individual[]): GedcomDoc => ({
  header: { gedcomVersion: '7.0' },
  individuals,
  families: [],
});

const found = (document_: GedcomDoc, query: string): string[] =>
  findByName(document_, query).map((match) => match.name);

const household = doc([
  { xref: '@I1@', names: [{ value: 'GivenA /SurnameB/' }] },
  { xref: '@I2@', names: [{ value: 'GivenC Middle /SurnameB/' }] },
  { xref: '@I3@', names: [{ value: 'GivenD /Fàbregas/' }] },
  { xref: '@I4@', names: [{ value: 'SurnameB /GivenA/' }] },
]);

describe('fold', () => {
  it('takes the accents off and the case with them', () => {
    expect(fold('Fàbregas')).toBe('fabregas');
    expect(fold('MUÑOZ')).toBe('munoz');
  });
});

describe('findByName', () => {
  it('finds nobody for an empty query, rather than everybody', () => {
    // The chart is already showing them. A list of the whole file under the box is noise.
    expect(findByName(household, '')).toEqual([]);
    expect(findByName(household, '   ')).toEqual([]);
  });

  it('matches without the accent the reader did not type', () => {
    expect(found(household, 'fabregas')).toEqual(['GivenD Fàbregas']);
  });

  it('still matches when the accent is typed', () => {
    expect(found(household, 'Fàbregas')).toEqual(['GivenD Fàbregas']);
  });

  it('matches every word in any order, so a forgotten middle name costs nothing', () => {
    expect(found(household, 'surnameb givenc')).toEqual(['GivenC Middle SurnameB']);
  });

  it('puts the name that starts with the query first', () => {
    /* @I1@ opens with GivenA; @I4@ merely contains it. Both match, and the one the reader is
       most likely to have meant is offered first. */
    expect(found(household, 'givena')).toEqual(['GivenA SurnameB', 'SurnameB GivenA']);
  });

  it('finds a record by its identifier, without the delimiters', () => {
    // A genealogist chasing @I3@ through an audit report should be able to paste it in.
    expect(found(household, 'I3')).toEqual(['GivenD Fàbregas']);
  });

  it('carries the years, so two people of one name can be told apart', () => {
    const namesakes = doc([
      {
        xref: '@I1@',
        names: [{ value: 'GivenA /SurnameB/' }],
        events: [{ tag: 'BIRT', date: { value: '1820', start: { year: 1820 } } }],
      },
      {
        xref: '@I2@',
        names: [{ value: 'GivenA /SurnameB/' }],
        events: [{ tag: 'BIRT', date: { value: '1878', start: { year: 1878 } } }],
      },
    ]);
    expect(findByName(namesakes, 'givena').map((match) => match.years)).toEqual([
      '1820–',
      '1878–',
    ]);
  });

  it('offers no more than it was asked for', () => {
    const many = doc(
      Array.from({ length: 40 }, (_, at) => ({
        xref: `@I${String(at)}@`,
        names: [{ value: `GivenA${String(at)} /SurnameB/` }],
      })),
    );
    expect(findByName(many, 'surnameb')).toHaveLength(8);
    expect(findByName(many, 'surnameb', 3)).toHaveLength(3);
  });

  it('names a person with no NAME record by their identifier, which is what the chart draws', () => {
    expect(found(doc([{ xref: '@I7@' }]), 'I7')).toEqual(['I7']);
  });
});
