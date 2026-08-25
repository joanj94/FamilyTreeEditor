/**
 * Form fields to model values.
 *
 * The test that matters most is the round trip through the payload. On import the payload is
 * authoritative and the pieces are a reading of it; on edit that inverts, and a form that wrote
 * only the pieces would leave the old payload in place -- so the edit would appear in the form,
 * appear in the chart, and be missing from the exported file. That is the worst shape of bug this
 * project has: one the user cannot see until the file is somewhere else.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { eventDate, nameOf, writeEvent, writeName } from './fields.js';
import type { Individual } from '../model/types.js';

describe('reading a name into a form', () => {
  it('reads the parsed pieces where the import found them', () => {
    const person: Individual = {
      xref: '@I1@',
      names: [{ value: 'GivenA /SurnameB/', given: ['GivenA'], surname: ['SurnameB'] }],
    };
    expect(nameOf(person)).toEqual({ given: 'GivenA', surnames: ['SurnameB'] });
  });

  it('reads both surnames where a name carries two', () => {
    const person: Individual = {
      xref: '@I1@',
      names: [{ value: 'GivenA /SurnameB SurnameC/', surname: ['SurnameB', 'SurnameC'] }],
    };
    expect(nameOf(person).surnames).toEqual(['SurnameB', 'SurnameC']);
  });

  it('falls back to the payload where no pieces were parsed', () => {
    expect(nameOf({ xref: '@I1@', names: [{ value: 'GivenA /SurnameB/' }] })).toEqual({
      given: 'GivenA',
      surnames: ['SurnameB'],
    });
  });

  it('copes with a payload carrying no surname delimiters', () => {
    expect(nameOf({ xref: '@I1@', names: [{ value: 'GivenA' }] })).toEqual({
      given: 'GivenA',
      surnames: [''],
    });
  });

  it('gives an unnamed person empty fields rather than failing', () => {
    expect(nameOf({ xref: '@I1@' })).toEqual({ given: '', surnames: [''] });
    expect(nameOf(undefined)).toEqual({ given: '', surnames: [''] });
  });
});

describe('writing a name back', () => {
  it('rewrites the payload from what was typed', () => {
    // Not just the pieces: the payload is what export writes.
    expect(writeName({ given: 'GivenA', surnames: ['SurnameB'] })).toEqual({
      value: 'GivenA /SurnameB/',
      given: ['GivenA'],
      surname: ['SurnameB'],
    });
  });

  it('writes a second surname as a second piece, not as a convention', () => {
    const name = writeName({ given: 'GivenA', surnames: ['SurnameB', 'SurnameC'] });
    expect(name.surname).toEqual(['SurnameB', 'SurnameC']);
    expect(name.value).toBe('GivenA /SurnameB SurnameC/');
  });

  it('drops the surname fields left blank', () => {
    expect(writeName({ given: 'GivenA', surnames: ['SurnameB', '  '] }).surname).toEqual([
      'SurnameB',
    ]);
  });

  it('survives a round trip through the form', () => {
    const parts = { given: 'GivenA', surnames: ['SurnameB', 'SurnameC'] };
    expect(nameOf({ xref: '@I1@', names: [writeName(parts)] })).toEqual(parts);
  });

  it('writes something usable for a person with only a surname', () => {
    expect(writeName({ given: '', surnames: ['SurnameB'] }).value).toBe('/SurnameB/');
  });
});

describe('dates on events', () => {
  const person: Individual = {
    xref: '@I1@',
    events: [
      { tag: 'BIRT', date: { value: '1 JAN 1900' } },
      { tag: 'DEAT', date: { value: '2 FEB 1970' } },
    ],
  };

  it('reads the payload the file wrote', () => {
    expect(eventDate(person, 'BIRT')).toBe('1 JAN 1900');
    expect(eventDate(person, 'BURI')).toBe('');
  });

  it('replaces one event and leaves the others alone', () => {
    const events = writeEvent(person, 'BIRT', '3 MAR 1901');
    expect(events.find((event) => event.tag === 'BIRT')?.date?.value).toBe('3 MAR 1901');
    expect(events.find((event) => event.tag === 'DEAT')?.date?.value).toBe('2 FEB 1970');
  });

  it('parses what it stores, so the chart can show a year', () => {
    const events = writeEvent(person, 'BIRT', '3 MAR 1901');
    expect(events.find((event) => event.tag === 'BIRT')?.date?.start?.year).toBe(1901);
  });

  it('keeps a date it cannot parse exactly as written', () => {
    // An unparseable date is not an error. It is the user's date, and it leaves the tool as it
    // arrived.
    const events = writeEvent(person, 'BIRT', 'the year of the flood');
    const birth = events.find((event) => event.tag === 'BIRT');
    expect(birth?.date?.value).toBe('the year of the flood');
    expect(birth?.date?.kind).toBe('UNPARSED');
  });

  it('removes the event when the field is emptied', () => {
    expect(writeEvent(person, 'DEAT', '   ').map((event) => event.tag)).toEqual(['BIRT']);
  });

  it('adds an event the person did not have', () => {
    const events = writeEvent({ xref: '@I1@' }, 'BURI', '4 APR 1970');
    expect(events).toHaveLength(1);
    expect(events[0]?.tag).toBe('BURI');
  });
});
