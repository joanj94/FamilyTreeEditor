/**
 * The date grammar.
 *
 * The rule under test throughout: the payload survives verbatim, and no field is filled in that
 * the source did not state. A year-only date has no month and no day, so a false precision is not
 * something the parser declines to write -- it is something it cannot write.
 */
import { describe, expect, it } from 'vitest';

import { parseDateValue } from './dates.js';

describe('parseDateValue', () => {
  it('keeps the payload verbatim whatever else it does', () => {
    for (const value of ['4 MAR 1901', 'ABT 1901', 'nonsense', '', 'BET 1901 AND 1905']) {
      expect(parseDateValue(value).value).toBe(value);
    }
  });

  it('reads a full date', () => {
    expect(parseDateValue('4 MAR 1901')).toEqual({
      value: '4 MAR 1901',
      kind: 'EXACT',
      start: { calendar: 'GREGORIAN', year: 1901, month: 3, day: 4 },
    });
  });

  it('reads a month and year without inventing a day', () => {
    expect(parseDateValue('MAR 1901').start).toEqual({
      calendar: 'GREGORIAN',
      year: 1901,
      month: 3,
    });
  });

  it('reads a year without inventing a month', () => {
    const parsed = parseDateValue('1901');
    expect(parsed.start).toEqual({ calendar: 'GREGORIAN', year: 1901 });
    expect(parsed.start).not.toHaveProperty('month');
    expect(parsed.start).not.toHaveProperty('day');
  });

  it('reads every month name', () => {
    const months = [
      'JAN',
      'FEB',
      'MAR',
      'APR',
      'MAY',
      'JUN',
      'JUL',
      'AUG',
      'SEP',
      'OCT',
      'NOV',
      'DEC',
    ];
    months.forEach((name, index) => {
      expect(parseDateValue(`${name} 1901`).start?.month).toBe(index + 1);
    });
  });

  it('marks an approximate date and keeps its keyword', () => {
    for (const keyword of ['ABT', 'CAL', 'EST'] as const) {
      const parsed = parseDateValue(`${keyword} 1901`);
      expect(parsed.kind).toBe('APPROXIMATE');
      expect(parsed.modifier).toBe(keyword);
      expect(parsed.start).toEqual({ calendar: 'GREGORIAN', year: 1901 });
    }
  });

  it('never gives an approximate date a precision it did not have', () => {
    // The failure this whole design exists to prevent: `ABT 1901` becoming 1 January 1901.
    const parsed = parseDateValue('ABT 1901');
    expect(parsed.start?.month).toBeUndefined();
    expect(parsed.start?.day).toBeUndefined();
  });

  it('reads an open-ended range', () => {
    expect(parseDateValue('BEF 1901')).toMatchObject({ kind: 'RANGE', modifier: 'BEF' });
    expect(parseDateValue('AFT 1901')).toMatchObject({ kind: 'RANGE', modifier: 'AFT' });
  });

  it('reads a closed range as two dates', () => {
    const parsed = parseDateValue('BET 4 MAR 1901 AND 1905');
    expect(parsed).toMatchObject({ kind: 'RANGE', modifier: 'BET' });
    expect(parsed.start).toEqual({ calendar: 'GREGORIAN', year: 1901, month: 3, day: 4 });
    expect(parsed.end).toEqual({ calendar: 'GREGORIAN', year: 1905 });
  });

  it('reads a period, open at either end or closed', () => {
    expect(parseDateValue('FROM 1901')).toMatchObject({ kind: 'PERIOD', modifier: 'FROM' });
    expect(parseDateValue('TO 1905')).toMatchObject({ kind: 'PERIOD', modifier: 'TO' });
    const closed = parseDateValue('FROM 1901 TO 1905');
    expect(closed).toMatchObject({ kind: 'PERIOD', modifier: 'FROM' });
    expect(closed.start?.year).toBe(1901);
    expect(closed.end?.year).toBe(1905);
  });

  it('reads a calendar named the GEDCOM 7 way', () => {
    expect(parseDateValue('JULIAN 1701').start).toEqual({ calendar: 'JULIAN', year: 1701 });
  });

  it('reads a calendar escaped the 5.5.1 way', () => {
    // 5.5.1 wrote the calendar as `@#DJULIAN@`. The two spellings mean the same thing, and a
    // reader that knew only one would misread half the files in circulation.
    expect(parseDateValue('@#DJULIAN@ 1701').start).toEqual({ calendar: 'JULIAN', year: 1701 });
  });

  it('reads an epoch', () => {
    expect(parseDateValue('44 BCE').start).toEqual({
      calendar: 'GREGORIAN',
      year: 44,
      epoch: 'BCE',
    });
  });

  it('reads a dual-dated year as the year the source wrote first', () => {
    // 5.5.1 allows `1699/00` for the period when the year began in March. Taking the first is the
    // documented reading; the payload keeps the pair, so nothing is lost either way.
    const parsed = parseDateValue('1699/00');
    expect(parsed.start?.year).toBe(1699);
    expect(parsed.value).toBe('1699/00');
  });

  it('captures the phrase of an interpreted date', () => {
    const parsed = parseDateValue('INT 1901 (as read from the register)');
    expect(parsed.phrase).toBe('as read from the register');
    expect(parsed.start?.year).toBe(1901);
  });

  it('marks a date it cannot read as unparsed, and loses nothing', () => {
    // Not an error. The payload exports byte-identical, so a date this parser does not understand
    // still leaves the tool exactly as it arrived.
    const parsed = parseDateValue('sometime in the spring');
    expect(parsed.kind).toBe('UNPARSED');
    expect(parsed.value).toBe('sometime in the spring');
    expect(parsed.start).toBeUndefined();
  });

  it('marks an empty payload as unparsed rather than inventing a date', () => {
    expect(parseDateValue('')).toEqual({ value: '', kind: 'UNPARSED' });
  });

  it('tolerates the spacing and case a real file uses', () => {
    expect(parseDateValue('  abt   1901  ')).toMatchObject({
      kind: 'APPROXIMATE',
      modifier: 'ABT',
    });
  });

  it('does not read a day out of range as a day', () => {
    // `32 MAR 1901` is not a date. Reading it as one would put a fact in the document that the
    // source does not support.
    expect(parseDateValue('32 MAR 1901').kind).toBe('UNPARSED');
  });
});
