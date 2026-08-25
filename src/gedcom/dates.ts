/**
 * The GEDCOM date grammar.
 *
 * Two rules govern everything here.
 *
 * **The payload survives verbatim.** `GenDate.value` is what the file said and is authoritative;
 * everything else is this parser's reading of it. A date the parser does not understand is not an
 * error -- it is `kind: 'UNPARSED'` with the payload intact, and it exports byte-identical. That
 * makes the parser's coverage a question of how much the tool can *use*, never of how much it can
 * keep.
 *
 * **No field is filled in that the source did not state.** A year-only date carries no month and
 * no day. Writing `1901-01-01` for `ABT 1901` invents a day and a month nobody claimed, and is
 * the difference between a genealogy tool and a lossy one. Because precision lives in which
 * fields are present rather than in a separate enum, that mistake is not one the parser declines
 * to make -- it is one it cannot express.
 *
 * The grammar, from the specification:
 *
 *     DateValue  = date | DatePeriod | dateRange | dateApprox
 *     date       = [calendar D] [[day D] month D] year [D epoch]
 *     dateApprox = (ABT | CAL | EST) D date
 *     dateRange  = BET D date D AND D date | AFT D date | BEF D date
 *     DatePeriod = TO D date | FROM D date [D TO D date]
 */
import type { CalendarDate, GenDate } from '../model/types.js';

/** Gregorian and Julian month names. Both calendars use the same twelve. */
const MONTHS: readonly string[] = [
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

const CALENDARS = new Set(['GREGORIAN', 'JULIAN', 'FRENCH_R', 'HEBREW']);

/**
 * The calendar a date is in when it does not say.
 *
 * Applying the specification's stated default is not the same as inventing a value: a file that
 * omits the calendar means Gregorian, and recording that is reading the standard rather than
 * guessing at the source.
 */
const DEFAULT_CALENDAR = 'GREGORIAN';

/** 5.5.1 wrote the calendar as an escape, `@#DJULIAN@`. GEDCOM 7 writes the bare keyword. */
const CALENDAR_ESCAPE = /^@#D([A-Z_]+)@$/;

const APPROXIMATE = new Set(['ABT', 'CAL', 'EST']);

/**
 * Read one date point.
 *
 * Returns `undefined` rather than a partial reading: a token this does not understand means the
 * whole payload is better kept as `UNPARSED` than half-interpreted into a fact the source does
 * not support.
 */
function parseDatePoint(tokens: readonly string[]): CalendarDate | undefined {
  if (tokens.length === 0) return undefined;

  const rest = [...tokens];
  let calendar = DEFAULT_CALENDAR;

  const first = rest[0] ?? '';
  const escaped = CALENDAR_ESCAPE.exec(first)?.[1];
  if (escaped !== undefined) {
    calendar = escaped;
    rest.shift();
  } else if (CALENDARS.has(first)) {
    calendar = first;
    rest.shift();
  }

  let epoch: string | undefined;
  if (rest[rest.length - 1] === 'BCE') {
    epoch = 'BCE';
    rest.pop();
  }

  // What remains is `[[day] month] year`, so the year is always last.
  const yearToken = rest.pop();
  if (yearToken === undefined) return undefined;

  // 5.5.1 permits a dual year -- `1699/00`, from when the year began in March. The documented
  // reading is the first of the pair; the payload keeps both, so nothing is lost by choosing.
  if (!/^\d{1,4}(\/\d{1,4})?$/.test(yearToken)) return undefined;
  const year = Number.parseInt(yearToken.split('/')[0] ?? '', 10);
  if (Number.isNaN(year)) return undefined;

  let month: number | undefined;
  let day: number | undefined;

  if (rest.length > 0) {
    const monthToken = rest.pop() ?? '';
    const index = MONTHS.indexOf(monthToken);
    if (index === -1) return undefined;
    month = index + 1;
  }

  if (rest.length > 0) {
    const dayToken = rest.pop() ?? '';
    if (!/^\d{1,2}$/.test(dayToken)) return undefined;
    const parsed = Number.parseInt(dayToken, 10);
    // A day outside 1-31 is not a day. Reading it as one would put a fact in the document that
    // the source does not support.
    if (parsed < 1 || parsed > 31) return undefined;
    day = parsed;
  }

  // Anything still unconsumed means the payload was not a date after all.
  if (rest.length > 0) return undefined;

  return {
    calendar,
    year,
    ...(month === undefined ? {} : { month }),
    ...(day === undefined ? {} : { day }),
    ...(epoch === undefined ? {} : { epoch }),
  };
}

function unparsed(value: string, phrase: string | undefined): GenDate {
  return { value, kind: 'UNPARSED', ...(phrase === undefined ? {} : { phrase }) };
}

/**
 * Parse a `DATE` payload.
 *
 * Case and spacing are normalised for reading only -- real files vary in both, and rejecting a
 * date over a double space would fail the user for their previous program's habits. The value
 * returned always carries the payload exactly as it arrived.
 */
export function parseDateValue(value: string): GenDate {
  // 5.5.1's interpreted date: `INT <date> (<phrase>)`. The phrase is what a human said the date
  // meant, and it is worth more than the interpretation when the two disagree.
  const interpreted = /^\s*INT\s+(.*?)\s*\(([^)]*)\)\s*$/i.exec(value);
  const phrase = interpreted?.[2];
  const body = (interpreted?.[1] ?? value).trim().replace(/\s+/g, ' ');

  if (body === '') return unparsed(value, phrase);

  const tokens = body.split(' ').map((token) => token.toUpperCase());
  const keyword = tokens[0] ?? '';
  const withPhrase = phrase === undefined ? {} : { phrase };

  if (APPROXIMATE.has(keyword)) {
    const start = parseDatePoint(tokens.slice(1));
    if (start === undefined) return unparsed(value, phrase);
    return {
      value,
      kind: 'APPROXIMATE',
      modifier: keyword as 'ABT' | 'CAL' | 'EST',
      start,
      ...withPhrase,
    };
  }

  if (keyword === 'BEF' || keyword === 'AFT') {
    const start = parseDatePoint(tokens.slice(1));
    if (start === undefined) return unparsed(value, phrase);
    return { value, kind: 'RANGE', modifier: keyword, start, ...withPhrase };
  }

  if (keyword === 'BET') {
    const and = tokens.indexOf('AND');
    if (and === -1) return unparsed(value, phrase);
    const start = parseDatePoint(tokens.slice(1, and));
    const end = parseDatePoint(tokens.slice(and + 1));
    if (start === undefined || end === undefined) return unparsed(value, phrase);
    return { value, kind: 'RANGE', modifier: 'BET', start, end, ...withPhrase };
  }

  if (keyword === 'FROM') {
    const to = tokens.indexOf('TO');
    const start = parseDatePoint(to === -1 ? tokens.slice(1) : tokens.slice(1, to));
    if (start === undefined) return unparsed(value, phrase);
    if (to === -1) return { value, kind: 'PERIOD', modifier: 'FROM', start, ...withPhrase };
    const end = parseDatePoint(tokens.slice(to + 1));
    if (end === undefined) return unparsed(value, phrase);
    return { value, kind: 'PERIOD', modifier: 'FROM', start, end, ...withPhrase };
  }

  if (keyword === 'TO') {
    const start = parseDatePoint(tokens.slice(1));
    if (start === undefined) return unparsed(value, phrase);
    return { value, kind: 'PERIOD', modifier: 'TO', start, ...withPhrase };
  }

  const start = parseDatePoint(tokens);
  if (start === undefined) return unparsed(value, phrase);
  return { value, kind: 'EXACT', start, ...withPhrase };
}
