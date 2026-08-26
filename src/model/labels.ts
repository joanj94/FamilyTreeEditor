/**
 * What a person is called on the chart, and the years under it.
 *
 * Here rather than in the renderer because the layout reads them too: a box is sized to the name
 * it carries, so the width of a name is a fact the geometry needs before anything is drawn. The
 * renderer still owns the drawing; this is only the reading of the record.
 */
import type { Individual } from './types.js';

/**
 * What a box says.
 *
 * The `NAME` payload is authoritative and already carries the whole name, with the surname
 * delimited by slashes; the pieces beside it are this tool's reading of it. So the payload is what
 * is drawn, with the delimiters taken out. A person with no name at all is drawn under their
 * identifier rather than as an empty box, because an empty box cannot be clicked with confidence.
 */
export function displayName(individual: Individual): string {
  const written = individual.names?.[0];
  const value = written?.value?.replace(/\//g, '').replace(/\s+/g, ' ').trim();
  if (value !== undefined && value !== '') return value;

  const pieces = [...(written?.given ?? []), ...(written?.surname ?? [])].join(' ').trim();
  return pieces === '' ? individual.xref : pieces;
}

/** The years under the name: birth and death, where the record gives them. */
export function displayYears(individual: Individual): string {
  const year = (tag: 'BIRT' | 'DEAT'): string => {
    const event = individual.events?.find((candidate) => candidate.tag === tag);
    const parsed = event?.date?.start?.year;
    if (parsed !== undefined) return String(parsed);
    /* An unparsed date still has its payload, and a reader would rather see it than nothing. */
    return event?.date?.value ?? '';
  };
  const born = year('BIRT');
  const died = year('DEAT');
  if (born === '' && died === '') return '';
  return `${born}–${died}`;
}
