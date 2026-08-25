/**
 * Turning what a form holds into what the model holds, and back.
 *
 * Two conversions, and each has a rule that is easy to get wrong.
 *
 * **A name has an authoritative payload and a reading of it.** On import the payload is what the
 * file said and the pieces are this tool's parse. On edit that inverts: the user typed the pieces,
 * so the payload is rewritten from them and the two cannot drift. Writing only the pieces would
 * leave the old payload in place -- and the payload is what export writes, so the edit would show
 * in the form, show in the chart, and vanish from the file.
 *
 * **A second surname is not a special field.** GEDCOM allows a name several `SURN` pieces, which
 * is exactly what a Catalan second surname is, so it needs no convention and no extra column: two
 * pieces go in, two come out, and a tool that understands only one still reads the payload.
 */
import { parseDateValue } from '../gedcom/dates.js';
import type {
  GenName,
  Individual,
  IndividualEvent,
  IndividualEventTag,
} from '../model/types.js';

/** A name as a form holds it. */
export interface NameParts {
  readonly given: string;
  /** One or more surnames, in order. Blank entries are dropped on the way in. */
  readonly surnames: readonly string[];
}

/** Read the first name on a record into form fields. */
export function nameOf(individual: Individual | undefined): NameParts {
  const name = individual?.names?.[0];
  if (name === undefined) return { given: '', surnames: [''] };

  const surnames = name.surname === undefined ? [] : [...name.surname];
  const given = name.given?.join(' ') ?? '';
  if (given !== '' || surnames.length > 0) {
    return { given, surnames: surnames.length > 0 ? surnames : [''] };
  }

  /* No pieces were parsed, so read the payload the file wrote instead: everything between the
     slashes is the surname, everything before them the given name. */
  const written = name.value ?? '';
  const match = /^([^/]*)\/([^/]*)\//.exec(written);
  if (match === null) return { given: written.trim(), surnames: [''] };
  const found = (match[2] ?? '').trim().split(/\s+/).filter(Boolean);
  return { given: (match[1] ?? '').trim(), surnames: found.length > 0 ? found : [''] };
}

/**
 * Build a name from form fields, payload included.
 *
 * The payload follows the standard's shape -- the given name, then the surnames between slashes --
 * because that is the form every other GEDCOM tool reads.
 */
export function writeName(parts: NameParts): GenName {
  const given = parts.given.trim();
  const surnames = parts.surnames.map((one) => one.trim()).filter((one) => one !== '');
  const value = `${given} /${surnames.join(' ')}/`.replace(/\s+/g, ' ').trim();

  return {
    value,
    ...(given === '' ? {} : { given: [given] }),
    ...(surnames.length === 0 ? {} : { surname: surnames }),
  };
}

/** The payload of a person's event of that kind, as the file wrote it. */
export function eventDate(individual: Individual | undefined, tag: IndividualEventTag): string {
  return individual?.events?.find((event) => event.tag === tag)?.date?.value ?? '';
}

/**
 * Set one event's date, leaving every other event alone.
 *
 * The typed date is parsed as well as kept, so the chart can show a year -- but the payload is
 * what is stored and what is exported, so a date this parser does not understand is still the
 * user's date and still leaves the tool as they wrote it.
 */
export function writeEvent(
  individual: Individual,
  tag: IndividualEventTag,
  written: string,
): readonly IndividualEvent[] {
  const others = (individual.events ?? []).filter((event) => event.tag !== tag);
  const value = written.trim();
  if (value === '') return others;

  const existing = individual.events?.find((event) => event.tag === tag);
  return [...others, { ...existing, tag, date: parseDateValue(value) }];
}
