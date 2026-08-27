/**
 * What a person is called on the chart, and the marks that go under the name.
 *
 * Here rather than in the renderer because the layout reads them too: a box is sized to what it
 * carries, so the width of a name and of the line beneath it are facts the geometry needs before
 * anything is drawn. The renderer still owns the drawing; this is only the reading of the record.
 *
 * **Signs are drawn, words are spoken.** A chart is read at a glance, so sex is a sign and a death
 * is a dagger. A screen reader given the same string says "female sign" and "dagger", which is a
 * description of the typography rather than of the person -- so every glyph here has a spoken
 * counterpart, and `displayCaption` is what the accessible label is built from.
 */
import type { MessageKey, Translate } from '../i18n/keys.js';
import type { Family, GenDate, Individual, Sex, Xref } from './types.js';

/**
 * An identifier as a reader should see it.
 *
 * `@I1@` is the file's syntax: the `@`s are delimiters that tell a parser where the identifier
 * ends, and they say nothing to a person looking at a panel. The record is called `I1`, so that is
 * what is shown. Nothing is stripped from what is stored -- the model keeps the standard's form
 * throughout, and this is a reading of it, like every other function in this file.
 */
export function displayXref(xref: Xref): string {
  const inside = /^@(.+)@$/.exec(xref);
  return inside?.[1] ?? xref;
}

/**
 * The sign each sex is drawn as.
 *
 * `X` is GEDCOM 7's "neither male nor female" and takes ⚧; `U` is "undetermined", which is a
 * recorded state rather than a missing one and so gets a mark of its own. A record with no `SEX`
 * line at all gets nothing, because an absent value and an undetermined one are different claims
 * and a chart that drew them alike would be inventing one of them.
 */
const SEX_SIGNS: Readonly<Record<Sex, string>> = { M: '♂', F: '♀', X: '⚧', U: '?' };

/**
 * How each sex is spoken, for labels that are heard rather than read.
 *
 * Keys rather than words, because this is the half of the module that has a language. The signs
 * above have none -- ♀ is ♀ in every locale -- which is why only this side takes a translator.
 */
const SEX_WORDS: Readonly<Record<Sex, MessageKey>> = {
  M: 'sexWord.M',
  F: 'sexWord.F',
  X: 'sexWord.X',
  U: 'sexWord.U',
};

/** The sign for a sex, or nothing where the record does not give one. */
export function sexSign(sex: Sex | undefined): string {
  return sex === undefined ? '' : SEX_SIGNS[sex];
}

/** The word for a sex, or nothing where the record does not give one. */
export function sexWord(sex: Sex | undefined, t: Translate): string {
  return sex === undefined ? '' : t(SEX_WORDS[sex]);
}

/**
 * The dagger that marks a death.
 *
 * The genealogical convention, and the reason it is worth having: a year on its own says when
 * something happened, not what. A reader scanning a chart for who is still living should not have
 * to work that out from the position of a dash.
 */
export const DEATH_SIGN = '†';

/**
 * The signs a union is drawn with: `=` for a marriage, `≠` for a divorce.
 *
 * Here for the reason the dagger is: a year beside a dot says when something happened to the
 * couple, not what. Two dates on one line with nothing to tell them apart is the worst version of
 * that -- a reader cannot tell a long marriage from a short one followed by thirty years apart.
 *
 * **Not ⚭ and ⚮, which is what a genealogist would expect.** Those are the right characters and
 * they do not survive the drawing: at the size a dot's line is set, both render as the same pair
 * of small rings, because the slash that distinguishes a divorce is below what the fallback fonts
 * resolve. Two marks a reader cannot tell apart are worse than none, since they invite a
 * confident wrong reading. The pedigree-notation pair says the same thing in strokes every font
 * has -- a couple joined, and a join undone -- and the second is legibly the negation of the
 * first, which is exactly the relation the two events have.
 */
export const MARRIAGE_SIGN = '=';
export const DIVORCE_SIGN = '≠';

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
  return pieces === '' ? displayXref(individual.xref) : pieces;
}

/**
 * An event as this module reads one: a tag and, where the record gave one, a date.
 *
 * Structural rather than `IndividualEvent | FamilyEvent`, because a person's birth and a union's
 * marriage are read the same way and the reading should not have to know which record it came
 * from.
 */
interface Dated {
  readonly tag: string;
  readonly date?: GenDate;
}

/** The year of one event, as parsed, falling back to the payload the file wrote. */
function yearOf(events: readonly Dated[] | undefined, tag: string): string {
  const event = events?.find((candidate) => candidate.tag === tag);
  const parsed = event?.date?.start?.year;
  if (parsed !== undefined) return String(parsed);
  /* An unparsed date still has its payload, and a reader would rather see it than nothing. */
  return event?.date?.value ?? '';
}

/**
 * The years under the name: birth and death, where the record gives them.
 *
 * The dagger goes after the years, spaced off them, rather than in front of the death year. Put
 * between the dash and the digits it read as part of the number -- `1820–†1872` -- which is the
 * one thing a mark on a genealogy chart must not do. At the end it qualifies the whole span, and
 * the years are left to read as a range.
 *
 * The dash is kept either side regardless: a trailing dash is how a chart says that a birth is
 * known and an end is not.
 */
export function displayYears(individual: Individual): string {
  const born = yearOf(individual.events, 'BIRT');
  const died = yearOf(individual.events, 'DEAT');
  if (born === '' && died === '') return '';
  return `${born}–${died}${died === '' ? '' : ` ${DEATH_SIGN}`}`;
}

/**
 * The whole line under the name: the sign for the sex, then the years.
 *
 * One line rather than two because the box has room for one, and one string rather than two
 * fields because this is what `personWidth` measures -- a sign the width did not know about is a
 * sign drawn past the edge of the box made for it.
 */
export function displayMarks(individual: Individual): string {
  return [sexSign(individual.sex), displayYears(individual)]
    .filter((part) => part !== '')
    .join(' ');
}

/**
 * How a box is spoken.
 *
 * The same facts as `displayMarks`, in words. Assistive technology reads ♀ as "female sign" and †
 * as "dagger", which describes the drawing rather than the person -- so the label is built from
 * this instead of from the glyphs.
 *
 * This is the one function here that needs a language, and it is the reason the split above
 * exists: `displayMarks` is measured by the layout and must mean the same thing in every locale,
 * while this is read aloud and must not. A translator is passed in rather than imported, because
 * `model/` may not reach the UI -- see `eslint.config.js`.
 */
export function displayCaption(individual: Individual, t: Translate): string {
  const born = yearOf(individual.events, 'BIRT');
  const died = yearOf(individual.events, 'DEAT');
  const parts = [
    displayName(individual),
    sexWord(individual.sex, t),
    born === '' ? '' : t('caption.born', { year: born }),
    died === '' ? '' : t('caption.died', { year: died }),
  ];
  return parts.filter((part) => part !== '').join(', ');
}

/**
 * The line beside a union's dot: the marriage, then the divorce, each signed and dated.
 *
 * **A sign is drawn only where there is a year to sign**, exactly as the dagger above waits for a
 * date. An undated `MARR` -- GEDCOM's `1 MARR Y` -- is left to the panel: a lone sign beside a dot
 * reads as a date the chart has failed to draw rather than as one the record never gave, and a
 * union is already drawn as a partnership without it.
 *
 * Nothing is measured against this. A person's box is sized to what it carries; a dot has no box,
 * so a long mark is left to run past its dot and is knocked out of whatever it crosses -- see
 * `.union-marks` in `chart.css`.
 */
export function displayUnionMarks(family: Family): string {
  return [
    [MARRIAGE_SIGN, yearOf(family.events, 'MARR')] as const,
    [DIVORCE_SIGN, yearOf(family.events, 'DIV')] as const,
  ]
    .filter(([, year]) => year !== '')
    .map(([sign, year]) => `${sign} ${year}`)
    .join(' ');
}

/**
 * The same facts in words, for the accessible label of a dot.
 *
 * "equals 1878, not-equals 1889" is what a screen reader makes of the line above: the typography
 * rather than the couple. Signs are for the eye; this is for the ear, and it is the same split
 * `displayMarks` and `displayCaption` make above.
 */
export function displayUnionCaption(family: Family, t: Translate): string {
  const said = (tag: 'MARR' | 'DIV', key: MessageKey): string => {
    const year = yearOf(family.events, tag);
    return year === '' ? '' : t(key, { year });
  };
  return [said('MARR', 'caption.married'), said('DIV', 'caption.divorced')]
    .filter((part) => part !== '')
    .join(', ');
}
